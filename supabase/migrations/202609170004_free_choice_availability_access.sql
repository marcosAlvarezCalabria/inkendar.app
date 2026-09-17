create table public.free_choice_availability_access (
  artist_profile_id uuid primary key,
  studio_id uuid not null,
  token_hash bytea not null unique,
  range_start timestamptz not null,
  range_end timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 480),
  expires_at timestamptz not null,
  issued_at timestamptz not null,
  updated_at timestamptz not null,
  constraint free_choice_availability_access_hash_length check (octet_length(token_hash)=32),
  constraint free_choice_availability_access_range check (range_end>range_start and range_end<=range_start+interval '31 days'),
  constraint free_choice_availability_access_expiry check (expires_at>issued_at and expires_at<=range_end),
  constraint free_choice_availability_access_artist_tenant_fk foreign key (artist_profile_id,studio_id) references public.artist_profile(id,studio_id) on delete cascade
);
alter table public.free_choice_availability_access enable row level security;
revoke all on table public.free_choice_availability_access from public,anon,authenticated,service_role;

create function public.rotate_free_choice_availability_access(
  p_studio_id uuid,p_owner_user_id uuid,p_artist_profile_id uuid,p_token_hash text,
  p_range_start timestamptz,p_range_end timestamptz,p_duration_minutes integer,p_expires_at timestamptz,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_compatible boolean;
begin
  if p_studio_id is null or p_owner_user_id is null or p_artist_profile_id is null or p_token_hash is null
    or p_range_start is null or p_range_end is null or p_duration_minutes is null or p_expires_at is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$' or p_duration_minutes not between 15 and 480
    or p_range_start<p_now or p_range_end<=p_range_start or p_range_end>p_range_start+interval '31 days'
    or p_expires_at<=p_now or p_expires_at>p_range_end then
    raise exception 'invalid free-choice availability access' using errcode='22023';
  end if;
  perform private.assert_studio_owner(p_studio_id,p_owner_user_id);
  select exists(
    select 1 from public.artist_profile artist
    join public.artist_availability_rule rule on rule.artist_profile_id=artist.id and rule.studio_id=artist.studio_id
    join public.artist_calendar_assignment assignment on assignment.artist_profile_id=artist.id and assignment.studio_id=artist.studio_id and assignment.access_role in ('writer','owner')
    join public.google_calendar_connection connection on connection.id=assignment.connection_id and connection.studio_id=artist.studio_id
      and connection.status='ACTIVE' and connection.refresh_token_ciphertext is not null
      and connection.granted_scopes @> array['https://www.googleapis.com/auth/calendar.events.freebusy']::text[]
    where artist.id=p_artist_profile_id and artist.studio_id=p_studio_id
  ) into v_compatible;
  if not v_compatible then raise exception 'free-choice availability context not found' using errcode='P0002'; end if;
  insert into public.free_choice_availability_access(artist_profile_id,studio_id,token_hash,range_start,range_end,duration_minutes,expires_at,issued_at,updated_at)
  values(p_artist_profile_id,p_studio_id,pg_catalog.decode(p_token_hash,'hex'),p_range_start,p_range_end,p_duration_minutes,p_expires_at,p_now,p_now)
  on conflict(artist_profile_id) do update set token_hash=excluded.token_hash,range_start=excluded.range_start,range_end=excluded.range_end,duration_minutes=excluded.duration_minutes,expires_at=excluded.expires_at,issued_at=excluded.issued_at,updated_at=excluded.updated_at
  where free_choice_availability_access.studio_id=excluded.studio_id;
  return jsonb_build_object('expires_at',p_expires_at);
end $$;

create function public.get_public_free_choice_availability_context(p_token_hash text,p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid free-choice availability access' using errcode='22023'; end if;
  select jsonb_build_object(
    'range_start',access.range_start,'range_end',access.range_end,'duration_minutes',access.duration_minutes,'expires_at',access.expires_at,
    'artist_display_name',artist.display_name,'time_zone',rule.time_zone,'slot_increment_minutes',rule.slot_increment_minutes,
    'buffer_before_minutes',rule.buffer_before_minutes,'buffer_after_minutes',rule.buffer_after_minutes,
    'windows',coalesce((select jsonb_agg(jsonb_build_object('weekday',availability_window.weekday,'start_time',to_char(availability_window.start_time,'HH24:MI'),'end_time',to_char(availability_window.end_time,'HH24:MI')) order by availability_window.weekday,availability_window.start_time) from public.artist_availability_window availability_window where availability_window.artist_profile_id=access.artist_profile_id and availability_window.studio_id=access.studio_id),'[]'::jsonb),
    'calendar_id',assignment.calendar_id,
    'connection',jsonb_build_object('status',connection.status,'refresh_token_ciphertext',connection.refresh_token_ciphertext,'granted_scopes',connection.granted_scopes,'credential_generation',connection.credential_generation),
    'holds',coalesce((select jsonb_agg(jsonb_build_object('start_at',option.start_at,'end_at',option.end_at) order by option.start_at)
      from public.booking_option option join public.booking_offer offer on offer.id=option.offer_id and offer.studio_id=option.studio_id
      where option.studio_id=access.studio_id and option.artist_profile_id=access.artist_profile_id
        and ((option.status='HELD' and offer.status='OPEN' and offer.expires_at>p_now)
          or (option.status='SELECTED' and offer.status='SELECTED_PENDING_CONFIRMATION' and (offer.expires_at>p_now or exists(select 1 from public.booking_confirmation_operation operation where operation.booking_offer_id=offer.id and operation.studio_id=offer.studio_id and operation.state='INSERTING')))
          or (option.status='CONFIRMED' and offer.status='CONFIRMED' and exists(select 1 from public.appointment appointment where appointment.booking_offer_id=offer.id and appointment.booking_option_id=option.id and appointment.studio_id=offer.studio_id and appointment.status='CONFIRMED')))
        and option.start_at<access.range_end and option.end_at>access.range_start),'[]'::jsonb)
  ) into v_result
  from public.free_choice_availability_access access
  join public.artist_profile artist on artist.id=access.artist_profile_id and artist.studio_id=access.studio_id
  join public.artist_availability_rule rule on rule.artist_profile_id=access.artist_profile_id and rule.studio_id=access.studio_id
  join public.artist_calendar_assignment assignment on assignment.artist_profile_id=access.artist_profile_id and assignment.studio_id=access.studio_id and assignment.access_role in ('writer','owner')
  join public.google_calendar_connection connection on connection.id=assignment.connection_id and connection.studio_id=access.studio_id and connection.status='ACTIVE' and connection.refresh_token_ciphertext is not null and connection.granted_scopes @> array['https://www.googleapis.com/auth/calendar.events.freebusy']::text[]
  where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and access.expires_at>p_now;
  return v_result;
end $$;

create function public.mark_public_free_choice_availability_reauth_required(p_token_hash text,p_credential_generation bigint,p_now timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_changed boolean;
begin
  if p_token_hash is null or p_credential_generation is null or p_credential_generation<1 or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid reconnect request' using errcode='22023'; end if;
  with changed as (
    update public.google_calendar_connection connection set status='REAUTH_REQUIRED',updated_at=p_now
    from public.free_choice_availability_access access,public.artist_calendar_assignment assignment
    where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and access.expires_at>p_now
      and assignment.artist_profile_id=access.artist_profile_id and assignment.studio_id=access.studio_id
      and connection.id=assignment.connection_id and connection.studio_id=access.studio_id
      and connection.status='ACTIVE' and connection.credential_generation=p_credential_generation
    returning 1
  ) select exists(select 1 from changed) into v_changed;
  return v_changed;
end $$;

revoke all on function public.rotate_free_choice_availability_access(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,timestamptz),public.get_public_free_choice_availability_context(text,timestamptz),public.mark_public_free_choice_availability_reauth_required(text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.rotate_free_choice_availability_access(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,timestamptz),public.get_public_free_choice_availability_context(text,timestamptz),public.mark_public_free_choice_availability_reauth_required(text,bigint,timestamptz) to service_role;
