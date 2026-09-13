create schema if not exists private;
revoke all on schema private from public;

create type public.membership_role as enum ('OWNER', 'ARTIST');

create table public.studio (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profile (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profile_id_studio_unique unique (id, studio_id),
  constraint user_profile_studio_user_unique unique (studio_id, user_id)
);

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_profile_id uuid not null,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_profile_same_studio_fk
    foreign key (user_profile_id, studio_id)
    references public.user_profile(id, studio_id)
    on delete cascade,
  constraint membership_studio_user_unique unique (studio_id, user_id),
  constraint membership_identity_unique unique (id, studio_id, user_id, role)
);

create table public.artist_profile (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete cascade,
  membership_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role public.membership_role not null default 'ARTIST',
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_profile_requires_artist_role check (membership_role = 'ARTIST'),
  constraint artist_profile_membership_same_studio_user_fk
    foreign key (membership_id, studio_id, user_id, membership_role)
    references public.membership(id, studio_id, user_id, role)
    on delete cascade,
  constraint artist_profile_studio_membership_unique unique (studio_id, membership_id),
  constraint artist_profile_studio_user_unique unique (studio_id, user_id)
);

create index user_profile_user_id_idx on public.user_profile(user_id);
create index membership_user_id_idx on public.membership(user_id);
create index membership_user_profile_id_studio_id_idx
  on public.membership(user_profile_id, studio_id);
create index artist_profile_user_id_idx on public.artist_profile(user_id);
create index artist_profile_membership_studio_user_role_idx
  on public.artist_profile(membership_id, studio_id, user_id, membership_role);

create or replace function private.is_studio_owner(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership
    where public.membership.studio_id = target_studio_id
      and public.membership.user_id = (select auth.uid())
      and public.membership.role = 'OWNER'::public.membership_role
  );
$$;

create or replace function private.is_studio_artist(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership
    where public.membership.studio_id = target_studio_id
      and public.membership.user_id = (select auth.uid())
      and public.membership.role = 'ARTIST'::public.membership_role
  );
$$;

revoke all on function private.is_studio_owner(uuid) from public;
revoke all on function private.is_studio_artist(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_studio_owner(uuid) to authenticated;
grant execute on function private.is_studio_artist(uuid) to authenticated;

alter table public.studio enable row level security;
alter table public.user_profile enable row level security;
alter table public.membership enable row level security;
alter table public.artist_profile enable row level security;

revoke all on table public.studio from anon, authenticated;
revoke all on table public.user_profile from anon, authenticated;
revoke all on table public.membership from anon, authenticated;
revoke all on table public.artist_profile from anon, authenticated;

grant select, update, delete on table public.studio to authenticated;
grant select, insert, update, delete on table public.user_profile to authenticated;
grant select, insert, update, delete on table public.membership to authenticated;
grant select, insert, update, delete on table public.artist_profile to authenticated;

grant all on table public.studio to service_role;
grant all on table public.user_profile to service_role;
grant all on table public.membership to service_role;
grant all on table public.artist_profile to service_role;

create policy studio_owner_select
on public.studio
for select
to authenticated
using (private.is_studio_owner(id));

create policy studio_owner_update
on public.studio
for update
to authenticated
using (private.is_studio_owner(id))
with check (private.is_studio_owner(id));

create policy studio_owner_delete
on public.studio
for delete
to authenticated
using (private.is_studio_owner(id));

create policy user_profile_owner_all
on public.user_profile
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));

create policy user_profile_artist_select_self
on public.user_profile
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and private.is_studio_artist(studio_id)
);

create policy membership_owner_all
on public.membership
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));

create policy membership_artist_select_self
on public.membership
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

create policy artist_profile_owner_all
on public.artist_profile
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));

create policy artist_profile_artist_select_self
on public.artist_profile
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and private.is_studio_artist(studio_id)
);
