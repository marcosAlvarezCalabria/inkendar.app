alter table public.booking_option
  add constraint booking_option_confirmation_identity_unique unique (id, offer_id, studio_id, artist_profile_id);

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  tattoo_case_id uuid not null,
  artist_profile_id uuid not null,
  booking_offer_id uuid not null unique,
  booking_option_id uuid not null unique,
  status public.appointment_status not null default 'CONFIRMED',
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, studio_id),
  foreign key (tattoo_case_id, studio_id) references public.tattoo_case(id, studio_id) on delete restrict,
  foreign key (artist_profile_id, studio_id) references public.artist_profile(id, studio_id) on delete restrict,
  foreign key (booking_offer_id, studio_id, artist_profile_id) references public.booking_offer(id, studio_id, artist_profile_id) on delete restrict,
  foreign key (booking_option_id, booking_offer_id, studio_id, artist_profile_id) references public.booking_option(id, offer_id, studio_id, artist_profile_id) on delete restrict
);

create table public.appointment_google_event (
  appointment_id uuid primary key,
  studio_id uuid not null,
  connection_id uuid not null,
  calendar_id text not null check (char_length(calendar_id) between 1 and 1024 and calendar_id !~ '[[:cntrl:]]'),
  event_id text not null check (char_length(event_id) between 5 and 1024 and event_id ~ '^[a-v0-9]+$'),
  correlation text not null check (correlation ~ '^[A-Za-z0-9_-]{43}$'),
  synchronized_at timestamptz not null,
  unique (calendar_id, event_id),
  foreign key (appointment_id, studio_id) references public.appointment(id, studio_id) on delete restrict,
  foreign key (connection_id, studio_id) references public.google_calendar_connection(id, studio_id) on delete restrict
);

alter table public.appointment enable row level security;
alter table public.appointment_google_event enable row level security;
revoke all on table public.appointment, public.appointment_google_event from public, anon, authenticated, service_role;

create or replace function public.get_public_booking_confirmation_context(p_token_hash text, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid booking confirmation' using errcode = '22023'; end if;
  select jsonb_build_object(
    'state', case when offer.status = 'CONFIRMED' then 'CONFIRMED' else 'PENDING' end,
    'studio_id', offer.studio_id,
    'option_id', option.id,
    'start_at', option.start_at,
    'end_at', option.end_at,
    'calendar_id', assignment.calendar_id,
    'connection', case when connection.id is null then null else jsonb_build_object('id', connection.id, 'status', connection.status, 'refresh_token_ciphertext', connection.refresh_token_ciphertext, 'granted_scopes', connection.granted_scopes) end,
    'finalized', case when external.appointment_id is null then null else jsonb_build_object('event_id', external.event_id, 'correlation', external.correlation, 'confirmed_at', appointment.confirmed_at) end
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.booking_option option on option.offer_id = offer.id and option.studio_id = offer.studio_id
    and ((offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (offer.status = 'CONFIRMED' and option.status = 'CONFIRMED'))
  left join public.artist_calendar_assignment assignment on assignment.artist_profile_id = offer.artist_profile_id and assignment.studio_id = offer.studio_id
  left join public.google_calendar_connection connection on connection.id = assignment.connection_id and connection.studio_id = offer.studio_id
  left join public.appointment appointment on appointment.booking_offer_id = offer.id and appointment.booking_option_id = option.id and appointment.studio_id = offer.studio_id
  left join public.appointment_google_event external on external.appointment_id = appointment.id and external.studio_id = appointment.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (offer.status = 'CONFIRMED' or offer.expires_at > p_now);
  return v_result;
end $$;

create or replace function public.finalize_public_booking_confirmation(p_token_hash text, p_connection_id uuid, p_calendar_id text, p_event_id text, p_correlation text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option; v_appointment public.appointment; v_external public.appointment_google_event; v_assignment public.artist_calendar_assignment;
begin
  if p_token_hash is null or p_connection_id is null or p_calendar_id is null or p_event_id is null or p_correlation is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$' or char_length(p_calendar_id) not between 1 and 1024 or p_calendar_id ~ '[[:cntrl:]]'
    or char_length(p_event_id) not between 5 and 1024 or p_event_id !~ '^[a-v0-9]+$' or p_correlation !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'invalid booking confirmation' using errcode = '22023'; end if;
  select offer.* into v_offer from public.booking_offer_public_access access join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
    where access.token_hash = pg_catalog.decode(p_token_hash, 'hex') and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED') for update of offer;
  if not found or (v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and v_offer.expires_at <= p_now) then raise exception 'booking confirmation unavailable' using errcode = 'P0002'; end if;
  select option.* into strict v_option from public.booking_option option where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
    and ((v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (v_offer.status = 'CONFIRMED' and option.status = 'CONFIRMED')) for update;
  select assignment.* into v_assignment from public.artist_calendar_assignment assignment join public.google_calendar_connection connection on connection.id = assignment.connection_id and connection.studio_id = assignment.studio_id
    where assignment.artist_profile_id = v_offer.artist_profile_id and assignment.studio_id = v_offer.studio_id and assignment.connection_id = p_connection_id and assignment.calendar_id = p_calendar_id and connection.status = 'ACTIVE';
  if not found then raise exception 'calendar assignment changed' using errcode = 'P0003'; end if;
  if v_offer.status = 'SELECTED_PENDING_CONFIRMATION' then
    insert into public.appointment(studio_id, tattoo_case_id, artist_profile_id, booking_offer_id, booking_option_id, confirmed_at, created_at)
      values (v_offer.studio_id, v_offer.tattoo_case_id, v_offer.artist_profile_id, v_offer.id, v_option.id, p_now, p_now) returning * into v_appointment;
    insert into public.appointment_google_event(appointment_id, studio_id, connection_id, calendar_id, event_id, correlation, synchronized_at)
      values (v_appointment.id, v_offer.studio_id, p_connection_id, p_calendar_id, p_event_id, p_correlation, p_now);
    update public.booking_offer set status = 'CONFIRMED', updated_at = p_now where id = v_offer.id;
    update public.booking_option set status = 'CONFIRMED' where id = v_option.id;
  else
    select appointment.* into strict v_appointment from public.appointment appointment where appointment.booking_offer_id = v_offer.id and appointment.booking_option_id = v_option.id and appointment.studio_id = v_offer.studio_id;
    select external.* into strict v_external from public.appointment_google_event external where external.appointment_id = v_appointment.id and external.studio_id = v_offer.studio_id;
    if v_external.connection_id <> p_connection_id or v_external.calendar_id <> p_calendar_id or v_external.event_id <> p_event_id or v_external.correlation <> p_correlation then raise exception 'booking confirmation mismatch' using errcode = 'P0003'; end if;
  end if;
  return jsonb_build_object('confirmed_at', v_appointment.confirmed_at);
exception when no_data_found or too_many_rows then raise exception 'booking confirmation mismatch' using errcode = 'P0003';
end $$;

create or replace function public.mark_booking_confirmation_reauth_required(p_studio_id uuid, p_connection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_studio_id is null or p_connection_id is null then raise exception 'invalid reauth request' using errcode = '22023'; end if;
  update public.google_calendar_connection set status = 'REAUTH_REQUIRED', updated_at = now() where id = p_connection_id and studio_id = p_studio_id and status = 'ACTIVE';
  if not found then raise exception 'connection not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.select_public_booking_offer(p_token_hash text, p_option_selector text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option;
begin
  if p_token_hash is null or p_option_selector is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_option_selector !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'invalid public offer selection' using errcode = '22023'; end if;
  select offer.* into v_offer from public.booking_offer_public_access access join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
    where access.token_hash = pg_catalog.decode(p_token_hash, 'hex') and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION', 'CONFIRMED') and (offer.status = 'CONFIRMED' or offer.expires_at > p_now) for update of offer;
  if not found then raise exception 'public booking offer unavailable' using errcode = 'P0002'; end if;
  if v_offer.status = 'OPEN' then
    select option.* into v_option from public.booking_option option where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id and option.public_selector = p_option_selector::uuid and option.status = 'HELD' for update;
    if not found then raise exception 'public booking offer selection rejected' using errcode = 'P0003'; end if;
    update public.booking_offer set status = 'SELECTED_PENDING_CONFIRMATION', updated_at = p_now where id = v_offer.id;
    update public.booking_option set status = case when id = v_option.id then 'SELECTED'::public.booking_option_status else 'RELEASED'::public.booking_option_status end where offer_id = v_offer.id and studio_id = v_offer.studio_id and status = 'HELD';
  else
    select option.* into v_option from public.booking_option option where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id and option.status = case when v_offer.status = 'CONFIRMED' then 'CONFIRMED'::public.booking_option_status else 'SELECTED'::public.booking_option_status end;
    if not found or v_option.public_selector <> p_option_selector::uuid then raise exception 'public booking offer selection rejected' using errcode = 'P0003'; end if;
  end if;
  return jsonb_build_object('state', 'SELECTION_PENDING_CONFIRMATION');
end $$;

create or replace function public.get_public_booking_offer(p_token_hash text, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid public offer access' using errcode = '22023'; end if;
  select jsonb_build_object('state', case offer.status when 'OPEN' then 'OPEN' when 'CONFIRMED' then 'CONFIRMED' else 'SELECTION_PENDING_CONFIRMATION' end,
    'expires_at', offer.expires_at, 'confirmed_at', appointment.confirmed_at, 'artist_display_name', artist.display_name, 'time_zone', availability.time_zone,
    'options', (select jsonb_agg(case when offer.status = 'OPEN' then jsonb_build_object('selector', option.public_selector::text, 'start_at', option.start_at, 'end_at', option.end_at) else jsonb_build_object('start_at', option.start_at, 'end_at', option.end_at) end order by option.start_at)
      from public.booking_option option where option.offer_id = offer.id and option.studio_id = offer.studio_id and ((offer.status = 'OPEN' and option.status = 'HELD') or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (offer.status = 'CONFIRMED' and option.status = 'CONFIRMED')))) into v_result
  from public.booking_offer_public_access access join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.artist_profile artist on artist.id = offer.artist_profile_id and artist.studio_id = offer.studio_id
  left join public.artist_availability_rule availability on availability.artist_profile_id = offer.artist_profile_id and availability.studio_id = offer.studio_id
  left join public.appointment appointment on appointment.booking_offer_id = offer.id and appointment.studio_id = offer.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex') and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (offer.status = 'CONFIRMED' or offer.expires_at > p_now)
    and ((offer.status = 'OPEN' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'HELD') between 1 and 3)
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'SELECTED') = 1)
      or (offer.status = 'CONFIRMED' and appointment.status = 'CONFIRMED' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'CONFIRMED') = 1));
  return v_result;
end $$;

revoke all on function public.get_public_booking_confirmation_context(text,timestamptz), public.finalize_public_booking_confirmation(text,uuid,text,text,text,timestamptz), public.mark_booking_confirmation_reauth_required(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_public_booking_confirmation_context(text,timestamptz), public.finalize_public_booking_confirmation(text,uuid,text,text,text,timestamptz), public.mark_booking_confirmation_reauth_required(uuid,uuid) to service_role;
