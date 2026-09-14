create type public.google_calendar_connection_status as enum ('ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED');

create table public.google_oauth_attempt (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  studio_id uuid not null references public.studio(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index google_oauth_attempt_owner_expiry_idx
  on public.google_oauth_attempt(studio_id, owner_user_id, expires_at desc);

create table public.google_calendar_connection (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  provider text not null default 'google' check (provider = 'google'),
  status public.google_calendar_connection_status not null default 'DISCONNECTED',
  refresh_token_ciphertext text,
  granted_scopes text[] not null default '{}',
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint google_calendar_connection_studio_unique unique (studio_id),
  constraint google_calendar_connection_identity_unique unique (id, studio_id),
  constraint google_calendar_connection_active_has_token check (
    status <> 'ACTIVE' or (
      refresh_token_ciphertext is not null
      and char_length(refresh_token_ciphertext) between 20 and 8192
      and granted_scopes @> array['https://www.googleapis.com/auth/calendar.calendarlist.readonly']::text[]
    )
  ),
  constraint google_calendar_connection_disconnected_has_no_token check (
    status <> 'DISCONNECTED' or refresh_token_ciphertext is null
  )
);

create table public.artist_calendar_assignment (
  artist_profile_id uuid primary key,
  studio_id uuid not null references public.studio(id) on delete restrict,
  connection_id uuid not null,
  calendar_id text not null check (char_length(calendar_id) between 1 and 1024 and calendar_id !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_calendar_assignment_artist_same_studio_fk
    foreign key (artist_profile_id, studio_id)
    references public.artist_profile(id, studio_id)
    on delete cascade,
  constraint artist_calendar_assignment_connection_fk
    foreign key (connection_id, studio_id)
    references public.google_calendar_connection(id, studio_id)
    on delete cascade
);

create index artist_calendar_assignment_studio_idx on public.artist_calendar_assignment(studio_id);

alter table public.google_oauth_attempt enable row level security;
alter table public.google_calendar_connection enable row level security;
alter table public.artist_calendar_assignment enable row level security;
revoke all on table public.google_oauth_attempt from public, anon, authenticated, service_role;
revoke all on table public.google_calendar_connection from public, anon, authenticated, service_role;
revoke all on table public.artist_calendar_assignment from public, anon, authenticated, service_role;

create or replace function private.assert_studio_owner(target_studio_id uuid, target_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.membership
    where studio_id = target_studio_id and user_id = target_user_id and role = 'OWNER'::public.membership_role
  ) then
    raise exception 'owner authorization failed' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_studio_owner(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.create_google_oauth_attempt(
  p_state_hash text, p_studio_id uuid, p_owner_user_id uuid, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes 30 seconds' then
    raise exception 'invalid oauth expiry' using errcode = '22023';
  end if;
  delete from public.google_oauth_attempt
    where (studio_id = p_studio_id and owner_user_id = p_owner_user_id) or expires_at < now();
  insert into public.google_oauth_attempt(state_hash, studio_id, owner_user_id, expires_at)
  values (p_state_hash, p_studio_id, p_owner_user_id, p_expires_at);
end;
$$;

create or replace function public.consume_google_oauth_attempt(
  p_state_hash text, p_studio_id uuid, p_owner_user_id uuid, p_now timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare consumed boolean;
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  with updated as (
    update public.google_oauth_attempt set consumed_at = p_now
    where state_hash = p_state_hash and studio_id = p_studio_id and owner_user_id = p_owner_user_id
      and consumed_at is null and expires_at >= p_now
    returning 1
  ) select exists(select 1 from updated) into consumed;
  return consumed;
end;
$$;

create or replace function public.get_google_calendar_connection(p_studio_id uuid, p_owner_user_id uuid)
returns table(id uuid, studio_id uuid, status public.google_calendar_connection_status, refresh_token_ciphertext text, granted_scopes text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  return query select c.id, c.studio_id, c.status, c.refresh_token_ciphertext, c.granted_scopes
  from public.google_calendar_connection c where c.studio_id = p_studio_id;
end;
$$;

create or replace function public.activate_google_calendar_connection(
  p_studio_id uuid, p_owner_user_id uuid, p_refresh_token_ciphertext text, p_granted_scopes text[]
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  insert into public.google_calendar_connection(studio_id, status, refresh_token_ciphertext, granted_scopes, connected_at)
  values (p_studio_id, 'ACTIVE', p_refresh_token_ciphertext, p_granted_scopes, now())
  on conflict (studio_id) do update set
    status = 'ACTIVE', refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    granted_scopes = excluded.granted_scopes, connected_at = now(), updated_at = now();
end;
$$;

create or replace function public.mark_google_calendar_reauth_required(p_studio_id uuid, p_owner_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  update public.google_calendar_connection set status = 'REAUTH_REQUIRED', updated_at = now()
    where studio_id = p_studio_id;
end;
$$;

create or replace function public.disconnect_google_calendar(p_studio_id uuid, p_owner_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  delete from public.artist_calendar_assignment where studio_id = p_studio_id;
  update public.google_calendar_connection set status = 'DISCONNECTED', refresh_token_ciphertext = null,
    granted_scopes = '{}', connected_at = null, updated_at = now() where studio_id = p_studio_id;
end;
$$;

create or replace function public.list_artist_calendar_assignments(p_studio_id uuid, p_owner_user_id uuid)
returns table(artist_profile_id uuid, display_name text, calendar_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  return query select a.id, a.display_name, x.calendar_id
  from public.artist_profile a left join public.artist_calendar_assignment x on x.artist_profile_id = a.id
  where a.studio_id = p_studio_id order by a.display_name, a.id;
end;
$$;

create or replace function public.assign_artist_calendar(
  p_studio_id uuid, p_owner_user_id uuid, p_artist_profile_id uuid, p_calendar_id text
) returns void language plpgsql security definer set search_path = '' as $$
declare connection public.google_calendar_connection%rowtype;
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists (select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then
    raise exception 'artist not found' using errcode = 'P0002';
  end if;
  if p_calendar_id is null then
    delete from public.artist_calendar_assignment where artist_profile_id = p_artist_profile_id and studio_id = p_studio_id;
    return;
  end if;
  select * into connection from public.google_calendar_connection
    where studio_id = p_studio_id and status = 'ACTIVE';
  if not found then raise exception 'active connection not found' using errcode = 'P0002'; end if;
  insert into public.artist_calendar_assignment(artist_profile_id, studio_id, connection_id, calendar_id)
  values (p_artist_profile_id, p_studio_id, connection.id, p_calendar_id)
  on conflict (artist_profile_id) do update set connection_id = excluded.connection_id,
    calendar_id = excluded.calendar_id, updated_at = now();
end;
$$;

revoke all on function public.create_google_oauth_attempt(text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_google_oauth_attempt(text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_google_calendar_connection(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_google_calendar_connection(uuid, uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.mark_google_calendar_reauth_required(uuid, uuid) from public, anon, authenticated;
revoke all on function public.disconnect_google_calendar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_artist_calendar_assignments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_artist_calendar(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_google_oauth_attempt(text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.consume_google_oauth_attempt(text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.get_google_calendar_connection(uuid, uuid) to service_role;
grant execute on function public.activate_google_calendar_connection(uuid, uuid, text, text[]) to service_role;
grant execute on function public.mark_google_calendar_reauth_required(uuid, uuid) to service_role;
grant execute on function public.disconnect_google_calendar(uuid, uuid) to service_role;
grant execute on function public.list_artist_calendar_assignments(uuid, uuid) to service_role;
grant execute on function public.assign_artist_calendar(uuid, uuid, uuid, text) to service_role;
