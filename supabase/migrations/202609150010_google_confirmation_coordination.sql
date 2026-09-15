alter table public.google_calendar_connection
  add column credential_generation bigint not null default 1 check (credential_generation >= 1);

alter table public.artist_calendar_assignment
  add column access_role text check (access_role is null or access_role in ('writer', 'owner'));

create type public.booking_confirmation_operation_state as enum ('READY', 'INSERTING', 'FINALIZED');

create table public.booking_confirmation_operation (
  booking_offer_id uuid primary key,
  studio_id uuid not null,
  artist_profile_id uuid not null,
  booking_option_id uuid not null unique,
  connection_id uuid not null,
  calendar_id text not null check (char_length(calendar_id) between 1 and 1024 and calendar_id !~ '[[:cntrl:]]'),
  event_id text not null check (char_length(event_id) between 5 and 1024 and event_id ~ '^[a-v0-9]+$'),
  correlation text not null check (correlation ~ '^[A-Za-z0-9_-]{43}$'),
  state public.booking_confirmation_operation_state not null default 'READY',
  lease_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, event_id),
  constraint booking_confirmation_operation_lease_pair check ((lease_id is null) = (lease_expires_at is null)),
  constraint booking_confirmation_operation_offer_fk foreign key (booking_offer_id, studio_id, artist_profile_id)
    references public.booking_offer(id, studio_id, artist_profile_id) on delete restrict,
  constraint booking_confirmation_operation_option_fk foreign key (booking_option_id, booking_offer_id, studio_id, artist_profile_id)
    references public.booking_option(id, offer_id, studio_id, artist_profile_id) on delete restrict,
  constraint booking_confirmation_operation_connection_fk foreign key (connection_id, studio_id)
    references public.google_calendar_connection(id, studio_id) on delete restrict
);

alter table public.booking_confirmation_operation enable row level security;
revoke all on table public.booking_confirmation_operation from public, anon, authenticated, service_role;

insert into public.booking_confirmation_operation(
  booking_offer_id, studio_id, artist_profile_id, booking_option_id, connection_id,
  calendar_id, event_id, correlation, state, created_at, updated_at
)
select appointment.booking_offer_id, appointment.studio_id, appointment.artist_profile_id,
  appointment.booking_option_id, external.connection_id, external.calendar_id, external.event_id,
  external.correlation, 'FINALIZED', appointment.created_at, external.synchronized_at
from public.appointment appointment
join public.appointment_google_event external
  on external.appointment_id = appointment.id and external.studio_id = appointment.studio_id
on conflict (booking_offer_id) do nothing;

revoke all on function public.get_google_calendar_connection(uuid, uuid) from public, anon, authenticated, service_role;
drop function public.get_google_calendar_connection(uuid, uuid);
create function public.get_google_calendar_connection(p_studio_id uuid, p_owner_user_id uuid)
returns table(id uuid, studio_id uuid, status public.google_calendar_connection_status, refresh_token_ciphertext text, granted_scopes text[], credential_generation bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  return query select c.id, c.studio_id, c.status, c.refresh_token_ciphertext, c.granted_scopes, c.credential_generation
  from public.google_calendar_connection c where c.studio_id = p_studio_id;
end $$;

create or replace function public.activate_google_calendar_connection(
  p_studio_id uuid, p_owner_user_id uuid, p_refresh_token_ciphertext text, p_granted_scopes text[]
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  insert into public.google_calendar_connection(studio_id, status, refresh_token_ciphertext, granted_scopes, connected_at, credential_generation)
  values (p_studio_id, 'ACTIVE', p_refresh_token_ciphertext, p_granted_scopes, now(), 1)
  on conflict (studio_id) do update set
    status = 'ACTIVE', refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    granted_scopes = excluded.granted_scopes, connected_at = now(), updated_at = now(),
    credential_generation = public.google_calendar_connection.credential_generation + 1;
end $$;

revoke all on function public.mark_google_calendar_reauth_required(uuid, uuid) from public, anon, authenticated, service_role;
drop function public.mark_google_calendar_reauth_required(uuid, uuid);
create function public.mark_google_calendar_reauth_required(p_studio_id uuid, p_owner_user_id uuid, p_credential_generation bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_changed boolean;
begin
  if p_credential_generation is null or p_credential_generation < 1 then raise exception 'invalid credential generation' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  with changed as (
    update public.google_calendar_connection set status = 'REAUTH_REQUIRED', updated_at = now()
    where studio_id = p_studio_id and status = 'ACTIVE' and credential_generation = p_credential_generation returning 1
  ) select exists(select 1 from changed) into v_changed;
  return v_changed;
end $$;

revoke all on function public.assign_artist_calendar(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
drop function public.assign_artist_calendar(uuid, uuid, uuid, text);
create function public.assign_artist_calendar(
  p_studio_id uuid, p_owner_user_id uuid, p_artist_profile_id uuid, p_calendar_id text, p_access_role text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_connection public.google_calendar_connection%rowtype;
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists (select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then
    raise exception 'artist not found' using errcode = 'P0002';
  end if;
  if p_calendar_id is null and p_access_role is null then
    delete from public.artist_calendar_assignment where artist_profile_id = p_artist_profile_id and studio_id = p_studio_id;
    return;
  end if;
  if p_calendar_id is null or p_access_role not in ('writer', 'owner') then
    raise exception 'calendar cannot reconcile private events' using errcode = '22023';
  end if;
  select * into v_connection from public.google_calendar_connection where studio_id = p_studio_id and status = 'ACTIVE';
  if not found then raise exception 'active connection not found' using errcode = 'P0002'; end if;
  insert into public.artist_calendar_assignment(artist_profile_id, studio_id, connection_id, calendar_id, access_role)
  values (p_artist_profile_id, p_studio_id, v_connection.id, p_calendar_id, p_access_role)
  on conflict (artist_profile_id) do update set connection_id = excluded.connection_id,
    calendar_id = excluded.calendar_id, access_role = excluded.access_role, updated_at = now();
end $$;

revoke all on function public.get_artist_availability_configuration(uuid, uuid, uuid) from public, anon, authenticated, service_role;
drop function public.get_artist_availability_configuration(uuid, uuid, uuid);
create function public.get_artist_availability_configuration(p_studio_id uuid,p_owner_user_id uuid,p_artist_profile_id uuid)
returns table(calendar_id text,time_zone text,slot_increment_minutes integer,buffer_before_minutes integer,buffer_after_minutes integer,windows jsonb,connection_id uuid,connection_status public.google_calendar_connection_status,refresh_token_ciphertext text,granted_scopes text[],credential_generation bigint)
language plpgsql stable security definer set search_path='' as $$ begin
 perform private.assert_studio_owner(p_studio_id,p_owner_user_id);
 if not exists(select 1 from public.artist_profile where id=p_artist_profile_id and studio_id=p_studio_id) then raise exception 'artist not found' using errcode='P0002'; end if;
 return query select a.calendar_id,r.time_zone,r.slot_increment_minutes,r.buffer_before_minutes,r.buffer_after_minutes,
 coalesce((select jsonb_agg(jsonb_build_object('weekday',w.weekday,'start_time',to_char(w.start_time,'HH24:MI'),'end_time',to_char(w.end_time,'HH24:MI')) order by w.weekday,w.start_time) from public.artist_availability_window w where w.artist_profile_id=p_artist_profile_id),'[]'::jsonb),
 c.id,c.status,c.refresh_token_ciphertext,c.granted_scopes,c.credential_generation
 from (select 1) seed left join public.artist_calendar_assignment a on a.artist_profile_id=p_artist_profile_id and a.studio_id=p_studio_id left join public.artist_availability_rule r on r.artist_profile_id=p_artist_profile_id and r.studio_id=p_studio_id left join public.google_calendar_connection c on c.id=a.connection_id and c.studio_id=p_studio_id;
end $$;

create or replace function public.get_public_booking_confirmation_context(p_token_hash text, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid booking confirmation' using errcode = '22023'; end if;
  select jsonb_build_object(
    'state', case when offer.status = 'CONFIRMED' then 'CONFIRMED' else 'PENDING' end,
    'studio_id', offer.studio_id, 'option_id', option.id, 'start_at', option.start_at, 'end_at', option.end_at,
    'calendar_id', coalesce(operation.calendar_id, assignment.calendar_id),
    'connection', case when connection.id is null then null else jsonb_build_object('id', connection.id, 'status', connection.status, 'refresh_token_ciphertext', connection.refresh_token_ciphertext, 'granted_scopes', connection.granted_scopes, 'credential_generation', connection.credential_generation) end,
    'finalized', case when external.appointment_id is null then null else jsonb_build_object('event_id', external.event_id, 'correlation', external.correlation, 'confirmed_at', appointment.confirmed_at) end
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.booking_option option on option.offer_id = offer.id and option.studio_id = offer.studio_id
    and ((offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (offer.status = 'CONFIRMED' and option.status = 'CONFIRMED'))
  left join public.booking_confirmation_operation operation on operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id
  left join public.artist_calendar_assignment assignment on operation.booking_offer_id is null and assignment.artist_profile_id = offer.artist_profile_id and assignment.studio_id = offer.studio_id
  left join public.google_calendar_connection connection on connection.id = coalesce(operation.connection_id, assignment.connection_id) and connection.studio_id = offer.studio_id
  left join public.appointment appointment on appointment.booking_offer_id = offer.id and appointment.booking_option_id = option.id and appointment.studio_id = offer.studio_id
  left join public.appointment_google_event external on external.appointment_id = appointment.id and external.studio_id = appointment.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex') and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (offer.status = 'CONFIRMED' or offer.expires_at > p_now);
  return v_result;
end $$;

create function public.claim_public_booking_confirmation(p_token_hash text, p_event_id text, p_correlation text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option; v_operation public.booking_confirmation_operation;
  v_assignment public.artist_calendar_assignment; v_connection public.google_calendar_connection; v_lease uuid; v_finalized jsonb;
begin
  if p_token_hash is null or p_event_id is null or p_correlation is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$' or char_length(p_event_id) not between 5 and 1024
    or p_event_id !~ '^[a-v0-9]+$' or p_correlation !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid booking confirmation' using errcode = '22023';
  end if;
  select offer.* into v_offer from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex') and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED') for update of offer;
  if not found or (v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and v_offer.expires_at <= p_now) then return null; end if;
  begin
    select option.* into strict v_option from public.booking_option option where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
      and ((v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (v_offer.status = 'CONFIRMED' and option.status = 'CONFIRMED'));
  exception when no_data_found or too_many_rows then raise exception 'booking confirmation mismatch' using errcode = 'P0003'; end;
  select * into v_operation from public.booking_confirmation_operation where booking_offer_id = v_offer.id for update;
  if not found then
    select assignment.* into v_assignment from public.artist_calendar_assignment assignment
      where assignment.artist_profile_id = v_offer.artist_profile_id and assignment.studio_id = v_offer.studio_id
        and assignment.access_role in ('writer', 'owner');
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    select * into v_connection from public.google_calendar_connection where id = v_assignment.connection_id and studio_id = v_offer.studio_id
      and status = 'ACTIVE' and refresh_token_ciphertext is not null
      and granted_scopes @> array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']::text[];
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    v_lease := gen_random_uuid();
    insert into public.booking_confirmation_operation(booking_offer_id,studio_id,artist_profile_id,booking_option_id,connection_id,calendar_id,event_id,correlation,state,lease_id,lease_expires_at,created_at,updated_at)
      values(v_offer.id,v_offer.studio_id,v_offer.artist_profile_id,v_option.id,v_connection.id,v_assignment.calendar_id,p_event_id,p_correlation,'READY',v_lease,p_now + interval '2 minutes',p_now,p_now)
      returning * into v_operation;
  else
    if v_operation.booking_option_id <> v_option.id or v_operation.event_id <> p_event_id or v_operation.correlation <> p_correlation then
      raise exception 'booking confirmation mismatch' using errcode = 'P0003';
    end if;
    select * into v_connection from public.google_calendar_connection where id = v_operation.connection_id and studio_id = v_operation.studio_id
      and status = 'ACTIVE' and refresh_token_ciphertext is not null
      and granted_scopes @> array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']::text[];
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    if v_operation.lease_id is not null and v_operation.lease_expires_at > p_now then return jsonb_build_object('kind', 'BUSY'); end if;
    v_lease := gen_random_uuid();
    update public.booking_confirmation_operation set lease_id=v_lease, lease_expires_at=p_now + interval '2 minutes', updated_at=p_now
      where booking_offer_id=v_offer.id returning * into v_operation;
  end if;
  select case when external.appointment_id is null then null else jsonb_build_object('event_id',external.event_id,'correlation',external.correlation,'confirmed_at',appointment.confirmed_at) end
    into v_finalized from (select 1) seed left join public.appointment appointment on appointment.booking_offer_id=v_offer.id and appointment.booking_option_id=v_option.id and appointment.studio_id=v_offer.studio_id
    left join public.appointment_google_event external on external.appointment_id=appointment.id and external.studio_id=appointment.studio_id;
  return jsonb_build_object('kind','CLAIMED','mode',case when v_operation.state='READY' then 'INSERT_OR_RECONCILE' else 'RECONCILE_ONLY' end,
    'lease_id',v_operation.lease_id,'studio_id',v_operation.studio_id,'option_id',v_operation.booking_option_id,'start_at',v_option.start_at,'end_at',v_option.end_at,
    'calendar_id',v_operation.calendar_id,'event_id',v_operation.event_id,'correlation',v_operation.correlation,
    'connection',jsonb_build_object('id',v_connection.id,'status',v_connection.status,'refresh_token_ciphertext',v_connection.refresh_token_ciphertext,'granted_scopes',v_connection.granted_scopes,'credential_generation',v_connection.credential_generation),
    'finalized',v_finalized);
end $$;

create function public.begin_public_booking_confirmation_insert(p_token_hash text,p_lease_id uuid,p_now timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$ declare v_changed boolean; begin
 if p_token_hash is null or p_lease_id is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid booking confirmation' using errcode='22023'; end if;
 with changed as (update public.booking_confirmation_operation operation set state='INSERTING',updated_at=p_now
   from public.booking_offer_public_access access,public.booking_offer offer where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and offer.id=access.offer_id and offer.studio_id=access.studio_id
   and offer.id=operation.booking_offer_id and offer.studio_id=operation.studio_id and offer.status='SELECTED_PENDING_CONFIRMATION' and offer.expires_at>p_now
   and operation.state='READY' and operation.lease_id=p_lease_id and operation.lease_expires_at>p_now returning 1)
 select exists(select 1 from changed) into v_changed; return v_changed;
end $$;

create function public.release_public_booking_confirmation_claim(p_token_hash text,p_lease_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$ begin
 if p_token_hash is null or p_lease_id is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid booking confirmation' using errcode='22023'; end if;
 update public.booking_confirmation_operation operation set lease_id=null,lease_expires_at=null,updated_at=p_now
 from public.booking_offer_public_access access where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and access.offer_id=operation.booking_offer_id and access.studio_id=operation.studio_id
   and operation.state='READY' and operation.lease_id=p_lease_id;
end $$;

create function public.reset_public_booking_confirmation_insert(p_token_hash text,p_lease_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$ begin
 if p_token_hash is null or p_lease_id is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid booking confirmation' using errcode='22023'; end if;
 update public.booking_confirmation_operation operation set state='READY',lease_id=null,lease_expires_at=null,updated_at=p_now
 from public.booking_offer_public_access access where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and access.offer_id=operation.booking_offer_id and access.studio_id=operation.studio_id
   and operation.state='INSERTING' and operation.lease_id=p_lease_id;
end $$;

revoke all on function public.finalize_public_booking_confirmation(text,uuid,text,text,text,timestamptz) from public,anon,authenticated,service_role;
drop function public.finalize_public_booking_confirmation(text,uuid,text,text,text,timestamptz);
create function public.finalize_public_booking_confirmation(p_token_hash text,p_lease_id uuid,p_connection_id uuid,p_calendar_id text,p_event_id text,p_correlation text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_offer public.booking_offer;v_option public.booking_option;v_operation public.booking_confirmation_operation;v_appointment public.appointment;v_external public.appointment_google_event;
begin
 if p_token_hash is null or p_lease_id is null or p_connection_id is null or p_calendar_id is null or p_event_id is null or p_correlation is null or p_now is null
  or p_token_hash !~ '^[0-9a-f]{64}$' or char_length(p_calendar_id) not between 1 and 1024 or p_calendar_id ~ '[[:cntrl:]]'
  or char_length(p_event_id) not between 5 and 1024 or p_event_id !~ '^[a-v0-9]+$' or p_correlation !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'invalid booking confirmation' using errcode='22023'; end if;
 select offer.* into v_offer from public.booking_offer_public_access access join public.booking_offer offer on offer.id=access.offer_id and offer.studio_id=access.studio_id
  where access.token_hash=pg_catalog.decode(p_token_hash,'hex') and offer.status in ('SELECTED_PENDING_CONFIRMATION','CONFIRMED') for update of offer;
 if not found or (v_offer.status='SELECTED_PENDING_CONFIRMATION' and v_offer.expires_at<=p_now) then raise exception 'booking confirmation unavailable' using errcode='P0002'; end if;
 begin select option.* into strict v_option from public.booking_option option where option.offer_id=v_offer.id and option.studio_id=v_offer.studio_id
  and ((v_offer.status='SELECTED_PENDING_CONFIRMATION' and option.status='SELECTED') or (v_offer.status='CONFIRMED' and option.status='CONFIRMED')) for update;
 exception when no_data_found or too_many_rows then raise exception 'booking confirmation mismatch' using errcode='P0003';end;
 select * into v_operation from public.booking_confirmation_operation where booking_offer_id=v_offer.id for update;
 if not found or v_operation.booking_option_id<>v_option.id or v_operation.connection_id<>p_connection_id or v_operation.calendar_id<>p_calendar_id
  or v_operation.event_id<>p_event_id or v_operation.correlation<>p_correlation or v_operation.lease_id<>p_lease_id
  or (v_offer.status='SELECTED_PENDING_CONFIRMATION' and v_operation.state<>'INSERTING')
  or (v_offer.status='CONFIRMED' and v_operation.state<>'FINALIZED') then raise exception 'booking confirmation mismatch' using errcode='P0003';end if;
 if v_offer.status='SELECTED_PENDING_CONFIRMATION' then
  insert into public.appointment(studio_id,tattoo_case_id,artist_profile_id,booking_offer_id,booking_option_id,confirmed_at,created_at)
   values(v_offer.studio_id,v_offer.tattoo_case_id,v_offer.artist_profile_id,v_offer.id,v_option.id,p_now,p_now) returning * into v_appointment;
  insert into public.appointment_google_event(appointment_id,studio_id,connection_id,calendar_id,event_id,correlation,synchronized_at)
   values(v_appointment.id,v_offer.studio_id,p_connection_id,p_calendar_id,p_event_id,p_correlation,p_now);
  update public.booking_offer set status='CONFIRMED',updated_at=p_now where id=v_offer.id;
  update public.booking_option set status='CONFIRMED' where id=v_option.id;
 else
  begin select appointment.* into strict v_appointment from public.appointment appointment where appointment.booking_offer_id=v_offer.id and appointment.booking_option_id=v_option.id and appointment.studio_id=v_offer.studio_id;
   select external.* into strict v_external from public.appointment_google_event external where external.appointment_id=v_appointment.id and external.studio_id=v_offer.studio_id;
  exception when no_data_found or too_many_rows then raise exception 'booking confirmation mismatch' using errcode='P0003';end;
  if v_external.connection_id<>p_connection_id or v_external.calendar_id<>p_calendar_id or v_external.event_id<>p_event_id or v_external.correlation<>p_correlation then raise exception 'booking confirmation mismatch' using errcode='P0003';end if;
 end if;
 update public.booking_confirmation_operation set state='FINALIZED',lease_id=null,lease_expires_at=null,updated_at=p_now where booking_offer_id=v_offer.id;
 return jsonb_build_object('confirmed_at',v_appointment.confirmed_at);
end $$;

revoke all on function public.mark_booking_confirmation_reauth_required(uuid,uuid) from public,anon,authenticated,service_role;
drop function public.mark_booking_confirmation_reauth_required(uuid,uuid);
create function public.mark_booking_confirmation_reauth_required(p_studio_id uuid,p_connection_id uuid,p_credential_generation bigint)
returns boolean language plpgsql security definer set search_path='' as $$ declare v_changed boolean;begin
 if p_studio_id is null or p_connection_id is null or p_credential_generation is null or p_credential_generation<1 then raise exception 'invalid reauth request' using errcode='22023';end if;
 with changed as (update public.google_calendar_connection set status='REAUTH_REQUIRED',updated_at=now()
  where id=p_connection_id and studio_id=p_studio_id and status='ACTIVE' and credential_generation=p_credential_generation returning 1)
 select exists(select 1 from changed) into v_changed;return v_changed;
end $$;

revoke all on function public.get_google_calendar_connection(uuid,uuid),public.activate_google_calendar_connection(uuid,uuid,text,text[]),public.mark_google_calendar_reauth_required(uuid,uuid,bigint),public.assign_artist_calendar(uuid,uuid,uuid,text,text),public.get_artist_availability_configuration(uuid,uuid,uuid),public.get_public_booking_confirmation_context(text,timestamptz),public.claim_public_booking_confirmation(text,text,text,timestamptz),public.begin_public_booking_confirmation_insert(text,uuid,timestamptz),public.release_public_booking_confirmation_claim(text,uuid,timestamptz),public.reset_public_booking_confirmation_insert(text,uuid,timestamptz),public.finalize_public_booking_confirmation(text,uuid,uuid,text,text,text,timestamptz),public.mark_booking_confirmation_reauth_required(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.get_google_calendar_connection(uuid,uuid),public.activate_google_calendar_connection(uuid,uuid,text,text[]),public.mark_google_calendar_reauth_required(uuid,uuid,bigint),public.assign_artist_calendar(uuid,uuid,uuid,text,text),public.get_artist_availability_configuration(uuid,uuid,uuid),public.get_public_booking_confirmation_context(text,timestamptz),public.claim_public_booking_confirmation(text,text,text,timestamptz),public.begin_public_booking_confirmation_insert(text,uuid,timestamptz),public.release_public_booking_confirmation_claim(text,uuid,timestamptz),public.reset_public_booking_confirmation_insert(text,uuid,timestamptz),public.finalize_public_booking_confirmation(text,uuid,uuid,text,text,text,timestamptz),public.mark_booking_confirmation_reauth_required(uuid,uuid,bigint) to service_role;
