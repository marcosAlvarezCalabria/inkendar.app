create or replace function public.expire_booking_offers(p_studio_id uuid, p_owner_user_id uuid, p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_offer_id uuid;
begin
  if p_studio_id is null or p_owner_user_id is null or p_now is null then
    raise exception 'invalid expiry request' using errcode = '22023';
  end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);

  for v_offer_id in
    select offer.id
    from public.booking_offer offer
    where offer.studio_id = p_studio_id
      and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
      and offer.expires_at <= p_now
    order by offer.id
    for update of offer
  loop
    if exists (
      select 1 from public.booking_confirmation_operation operation
      where operation.booking_offer_id = v_offer_id
        and operation.studio_id = p_studio_id
        and operation.state = 'INSERTING'
    ) then
      continue;
    end if;

    update public.booking_offer
    set status = 'EXPIRED', updated_at = p_now
    where id = v_offer_id and studio_id = p_studio_id
      and status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION');
    if found then
      update public.booking_option
      set status = 'RELEASED'
      where offer_id = v_offer_id and studio_id = p_studio_id and status in ('HELD', 'SELECTED');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

create or replace function public.begin_public_booking_confirmation_insert(p_token_hash text, p_lease_id uuid, p_now timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_changed boolean;
begin
  if p_token_hash is null or p_lease_id is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid booking confirmation' using errcode = '22023';
  end if;
  select offer.* into v_offer
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
  for update of offer;
  if not found or v_offer.status <> 'SELECTED_PENDING_CONFIRMATION' or v_offer.expires_at <= p_now then
    return false;
  end if;
  with changed as (
    update public.booking_confirmation_operation operation
    set state = 'INSERTING', updated_at = p_now
    where operation.booking_offer_id = v_offer.id and operation.studio_id = v_offer.studio_id
      and operation.state = 'READY' and operation.lease_id = p_lease_id and operation.lease_expires_at > p_now
    returning 1
  ) select exists(select 1 from changed) into v_changed;
  return v_changed;
end $$;

create or replace function public.select_public_booking_offer(p_token_hash text, p_option_selector text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option;
begin
  if p_token_hash is null or p_option_selector is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_option_selector !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid public offer selection' using errcode = '22023';
  end if;
  select offer.* into v_offer
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (
      offer.status = 'CONFIRMED'
      or offer.expires_at > p_now
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and exists (
        select 1 from public.booking_confirmation_operation operation
        where operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id and operation.state = 'INSERTING'
      ))
    )
  for update of offer;
  if not found then raise exception 'public booking offer unavailable' using errcode = 'P0002'; end if;
  if v_offer.status = 'OPEN' then
    select option.* into v_option from public.booking_option option
    where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
      and option.public_selector = p_option_selector::uuid and option.status = 'HELD' for update;
    if not found then raise exception 'public booking offer selection rejected' using errcode = 'P0003'; end if;
    update public.booking_offer set status = 'SELECTED_PENDING_CONFIRMATION', updated_at = p_now where id = v_offer.id;
    update public.booking_option
    set status = case when id = v_option.id then 'SELECTED'::public.booking_option_status else 'RELEASED'::public.booking_option_status end
    where offer_id = v_offer.id and studio_id = v_offer.studio_id and status = 'HELD';
  else
    select option.* into v_option from public.booking_option option
    where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
      and option.status = case when v_offer.status = 'CONFIRMED' then 'CONFIRMED'::public.booking_option_status else 'SELECTED'::public.booking_option_status end;
    if not found or v_option.public_selector <> p_option_selector::uuid then
      raise exception 'public booking offer selection rejected' using errcode = 'P0003';
    end if;
  end if;
  return jsonb_build_object('state', 'SELECTION_PENDING_CONFIRMATION');
end $$;

create or replace function public.get_public_booking_offer(p_token_hash text, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid public offer access' using errcode = '22023'; end if;
  select jsonb_build_object(
    'state', case offer.status when 'OPEN' then 'OPEN' when 'CONFIRMED' then 'CONFIRMED' else 'SELECTION_PENDING_CONFIRMATION' end,
    'expires_at', offer.expires_at, 'confirmed_at', appointment.confirmed_at,
    'artist_display_name', artist.display_name, 'time_zone', availability.time_zone,
    'options', (select jsonb_agg(
      case when offer.status = 'OPEN' then jsonb_build_object('selector', option.public_selector::text, 'start_at', option.start_at, 'end_at', option.end_at)
        else jsonb_build_object('start_at', option.start_at, 'end_at', option.end_at) end order by option.start_at)
      from public.booking_option option where option.offer_id = offer.id and option.studio_id = offer.studio_id
        and ((offer.status = 'OPEN' and option.status = 'HELD')
          or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED')
          or (offer.status = 'CONFIRMED' and option.status = 'CONFIRMED')))
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.artist_profile artist on artist.id = offer.artist_profile_id and artist.studio_id = offer.studio_id
  left join public.artist_availability_rule availability on availability.artist_profile_id = offer.artist_profile_id and availability.studio_id = offer.studio_id
  left join public.appointment appointment on appointment.booking_offer_id = offer.id and appointment.studio_id = offer.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (
      offer.status = 'CONFIRMED' or offer.expires_at > p_now
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and exists (
        select 1 from public.booking_confirmation_operation operation
        where operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id and operation.state = 'INSERTING'
      ))
    )
    and ((offer.status = 'OPEN' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'HELD') between 1 and 3)
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'SELECTED') = 1)
      or (offer.status = 'CONFIRMED' and appointment.status = 'CONFIRMED' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.status = 'CONFIRMED') = 1));
  return v_result;
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
    'connection', case when connection.id is null then null else jsonb_build_object(
      'id', connection.id, 'status', connection.status, 'refresh_token_ciphertext', connection.refresh_token_ciphertext,
      'granted_scopes', connection.granted_scopes, 'credential_generation', connection.credential_generation) end,
    'finalized', case when external.appointment_id is null then null else jsonb_build_object(
      'event_id', external.event_id, 'correlation', external.correlation, 'confirmed_at', appointment.confirmed_at) end
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.booking_option option on option.offer_id = offer.id and option.studio_id = offer.studio_id
    and ((offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED') or (offer.status = 'CONFIRMED' and option.status = 'CONFIRMED'))
  left join public.booking_confirmation_operation operation on operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id
  left join public.artist_calendar_assignment assignment on operation.booking_offer_id is null
    and assignment.artist_profile_id = offer.artist_profile_id and assignment.studio_id = offer.studio_id
  left join public.google_calendar_connection connection on connection.id = coalesce(operation.connection_id, assignment.connection_id) and connection.studio_id = offer.studio_id
  left join public.appointment appointment on appointment.booking_offer_id = offer.id and appointment.booking_option_id = option.id and appointment.studio_id = offer.studio_id
  left join public.appointment_google_event external on external.appointment_id = appointment.id and external.studio_id = appointment.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
    and (
      offer.status = 'CONFIRMED' or offer.expires_at > p_now
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and operation.state = 'INSERTING')
    );
  return v_result;
end $$;

create or replace function public.claim_public_booking_confirmation(p_token_hash text, p_event_id text, p_correlation text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option; v_operation public.booking_confirmation_operation;
  v_assignment public.artist_calendar_assignment; v_connection public.google_calendar_connection; v_lease uuid; v_finalized jsonb; v_has_operation boolean;
begin
  if p_token_hash is null or p_event_id is null or p_correlation is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$' or char_length(p_event_id) not between 5 and 1024
    or p_event_id !~ '^[a-v0-9]+$' or p_correlation !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid booking confirmation' using errcode = '22023';
  end if;
  select offer.* into v_offer
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
  for update of offer;
  if not found then return null; end if;

  select * into v_operation from public.booking_confirmation_operation
  where booking_offer_id = v_offer.id for update;
  v_has_operation := found;
  if v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and v_offer.expires_at <= p_now
    and (not v_has_operation or v_operation.state <> 'INSERTING') then return null; end if;

  begin
    select option.* into strict v_option from public.booking_option option
    where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
      and ((v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED')
        or (v_offer.status = 'CONFIRMED' and option.status = 'CONFIRMED'));
  exception when no_data_found or too_many_rows then
    raise exception 'booking confirmation mismatch' using errcode = 'P0003';
  end;

  if not v_has_operation then
    select assignment.* into v_assignment from public.artist_calendar_assignment assignment
    where assignment.artist_profile_id = v_offer.artist_profile_id and assignment.studio_id = v_offer.studio_id
      and assignment.access_role in ('writer', 'owner');
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    select * into v_connection from public.google_calendar_connection
    where id = v_assignment.connection_id and studio_id = v_offer.studio_id and status = 'ACTIVE'
      and refresh_token_ciphertext is not null
      and granted_scopes @> array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']::text[];
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    v_lease := gen_random_uuid();
    insert into public.booking_confirmation_operation(
      booking_offer_id,studio_id,artist_profile_id,booking_option_id,connection_id,calendar_id,event_id,correlation,
      state,lease_id,lease_expires_at,created_at,updated_at)
    values(v_offer.id,v_offer.studio_id,v_offer.artist_profile_id,v_option.id,v_connection.id,v_assignment.calendar_id,
      p_event_id,p_correlation,'READY',v_lease,p_now + interval '2 minutes',p_now,p_now)
    returning * into v_operation;
  else
    if v_operation.booking_option_id <> v_option.id or v_operation.event_id <> p_event_id or v_operation.correlation <> p_correlation then
      raise exception 'booking confirmation mismatch' using errcode = 'P0003';
    end if;
    select * into v_connection from public.google_calendar_connection
    where id = v_operation.connection_id and studio_id = v_operation.studio_id and status = 'ACTIVE'
      and refresh_token_ciphertext is not null
      and granted_scopes @> array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']::text[];
    if not found then return jsonb_build_object('kind', 'RECONNECT_REQUIRED'); end if;
    if v_operation.lease_id is not null and v_operation.lease_expires_at > p_now then
      return jsonb_build_object('kind', 'BUSY');
    end if;
    v_lease := gen_random_uuid();
    update public.booking_confirmation_operation
    set lease_id = v_lease, lease_expires_at = p_now + interval '2 minutes', updated_at = p_now
    where booking_offer_id = v_offer.id returning * into v_operation;
  end if;
  select case when external.appointment_id is null then null else jsonb_build_object(
    'event_id', external.event_id, 'correlation', external.correlation, 'confirmed_at', appointment.confirmed_at) end
  into v_finalized from (select 1) seed
  left join public.appointment appointment on appointment.booking_offer_id = v_offer.id
    and appointment.booking_option_id = v_option.id and appointment.studio_id = v_offer.studio_id
  left join public.appointment_google_event external on external.appointment_id = appointment.id and external.studio_id = appointment.studio_id;
  return jsonb_build_object(
    'kind','CLAIMED','mode',case when v_operation.state = 'READY' then 'INSERT_OR_RECONCILE' else 'RECONCILE_ONLY' end,
    'lease_id',v_operation.lease_id,'studio_id',v_operation.studio_id,'option_id',v_operation.booking_option_id,
    'start_at',v_option.start_at,'end_at',v_option.end_at,'calendar_id',v_operation.calendar_id,
    'event_id',v_operation.event_id,'correlation',v_operation.correlation,
    'connection',jsonb_build_object('id',v_connection.id,'status',v_connection.status,
      'refresh_token_ciphertext',v_connection.refresh_token_ciphertext,'granted_scopes',v_connection.granted_scopes,
      'credential_generation',v_connection.credential_generation),
    'finalized',v_finalized);
end $$;

create or replace function public.finalize_public_booking_confirmation(
  p_token_hash text,p_lease_id uuid,p_connection_id uuid,p_calendar_id text,p_event_id text,p_correlation text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option public.booking_option; v_operation public.booking_confirmation_operation;
  v_appointment public.appointment; v_external public.appointment_google_event; v_has_operation boolean;
begin
  if p_token_hash is null or p_lease_id is null or p_connection_id is null or p_calendar_id is null
    or p_event_id is null or p_correlation is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or char_length(p_calendar_id) not between 1 and 1024 or p_calendar_id ~ '[[:cntrl:]]'
    or char_length(p_event_id) not between 5 and 1024 or p_event_id !~ '^[a-v0-9]+$'
    or p_correlation !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid booking confirmation' using errcode = '22023';
  end if;
  select offer.* into v_offer
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('SELECTED_PENDING_CONFIRMATION', 'CONFIRMED')
  for update of offer;
  if not found then raise exception 'booking confirmation unavailable' using errcode = 'P0002'; end if;

  select * into v_operation from public.booking_confirmation_operation
  where booking_offer_id = v_offer.id for update;
  v_has_operation := found;
  if v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and v_offer.expires_at <= p_now
    and (not v_has_operation or v_operation.state <> 'INSERTING') then
    raise exception 'booking confirmation unavailable' using errcode = 'P0002';
  end if;
  begin
    select option.* into strict v_option from public.booking_option option
    where option.offer_id = v_offer.id and option.studio_id = v_offer.studio_id
      and ((v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED')
        or (v_offer.status = 'CONFIRMED' and option.status = 'CONFIRMED')) for update;
  exception when no_data_found or too_many_rows then
    raise exception 'booking confirmation mismatch' using errcode = 'P0003';
  end;
  if not v_has_operation or v_operation.booking_option_id <> v_option.id or v_operation.connection_id <> p_connection_id
    or v_operation.calendar_id <> p_calendar_id or v_operation.event_id <> p_event_id
    or v_operation.correlation <> p_correlation or v_operation.lease_id <> p_lease_id
    or (v_offer.status = 'SELECTED_PENDING_CONFIRMATION' and v_operation.state <> 'INSERTING')
    or (v_offer.status = 'CONFIRMED' and v_operation.state <> 'FINALIZED') then
    raise exception 'booking confirmation mismatch' using errcode = 'P0003';
  end if;
  if v_offer.status = 'SELECTED_PENDING_CONFIRMATION' then
    insert into public.appointment(studio_id,tattoo_case_id,artist_profile_id,booking_offer_id,booking_option_id,confirmed_at,created_at)
    values(v_offer.studio_id,v_offer.tattoo_case_id,v_offer.artist_profile_id,v_offer.id,v_option.id,p_now,p_now)
    returning * into v_appointment;
    insert into public.appointment_google_event(appointment_id,studio_id,connection_id,calendar_id,event_id,correlation,synchronized_at)
    values(v_appointment.id,v_offer.studio_id,p_connection_id,p_calendar_id,p_event_id,p_correlation,p_now);
    update public.booking_offer set status = 'CONFIRMED', updated_at = p_now where id = v_offer.id;
    update public.booking_option set status = 'CONFIRMED' where id = v_option.id;
  else
    begin
      select appointment.* into strict v_appointment from public.appointment appointment
      where appointment.booking_offer_id = v_offer.id and appointment.booking_option_id = v_option.id and appointment.studio_id = v_offer.studio_id;
      select external.* into strict v_external from public.appointment_google_event external
      where external.appointment_id = v_appointment.id and external.studio_id = v_offer.studio_id;
    exception when no_data_found or too_many_rows then
      raise exception 'booking confirmation mismatch' using errcode = 'P0003';
    end;
    if v_external.connection_id <> p_connection_id or v_external.calendar_id <> p_calendar_id
      or v_external.event_id <> p_event_id or v_external.correlation <> p_correlation then
      raise exception 'booking confirmation mismatch' using errcode = 'P0003';
    end if;
  end if;
  update public.booking_confirmation_operation
  set state = 'FINALIZED', lease_id = null, lease_expires_at = null, updated_at = p_now
  where booking_offer_id = v_offer.id;
  return jsonb_build_object('confirmed_at', v_appointment.confirmed_at);
end $$;

create or replace function public.create_booking_offer(
  p_studio_id uuid,p_owner_user_id uuid,p_tattoo_case_id uuid,p_artist_profile_id uuid,p_options jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option jsonb; v_start timestamptz; v_end timestamptz; v_options jsonb;
begin
  if p_studio_id is null or p_owner_user_id is null or p_tattoo_case_id is null or p_artist_profile_id is null
    or p_options is null or p_now is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 3 then
    raise exception 'invalid booking offer' using errcode = '22023';
  end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.tattoo_case where id = p_tattoo_case_id and studio_id = p_studio_id and status = 'OPEN')
    or not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then
    raise exception 'booking context not found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text || ':' || p_artist_profile_id::text, 0));
  insert into public.booking_offer(studio_id,tattoo_case_id,artist_profile_id,expires_at,created_at,updated_at)
  select p_studio_id,p_tattoo_case_id,p_artist_profile_id,p_now + pg_catalog.make_interval(hours => studio.booking_offer_expiry_hours),p_now,p_now
  from public.studio studio where studio.id = p_studio_id returning * into v_offer;
  for v_option in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_option) <> 'object' or (select count(*) from jsonb_object_keys(v_option)) <> 2
      or jsonb_typeof(v_option -> 'startUtc') <> 'string' or jsonb_typeof(v_option -> 'endUtc') <> 'string' then
      raise exception 'invalid booking option' using errcode = '22023';
    end if;
    begin
      v_start := (v_option ->> 'startUtc')::timestamptz; v_end := (v_option ->> 'endUtc')::timestamptz;
    exception when others then raise exception 'invalid booking option' using errcode = '22023'; end;
    if v_start <= p_now or v_end <= v_start or extract(epoch from (v_end - v_start)) / 60 not between 15 and 480 then
      raise exception 'invalid booking option' using errcode = '22023';
    end if;
    if exists(
      select 1 from public.booking_option option
      join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
      where option.studio_id = p_studio_id and option.artist_profile_id = p_artist_profile_id
        and (
          (option.status = 'HELD' and offer.status = 'OPEN' and offer.expires_at > p_now)
          or (option.status = 'SELECTED' and offer.status = 'SELECTED_PENDING_CONFIRMATION' and (
            offer.expires_at > p_now or exists (
              select 1 from public.booking_confirmation_operation operation
              where operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id and operation.state = 'INSERTING'
            )))
          or (option.status = 'CONFIRMED' and offer.status = 'CONFIRMED' and exists(
            select 1 from public.appointment appointment
            where appointment.booking_offer_id = offer.id and appointment.booking_option_id = option.id
              and appointment.studio_id = offer.studio_id and appointment.status = 'CONFIRMED'))
        )
        and option.start_at < v_end and option.end_at > v_start
    ) then raise exception 'booking hold conflict' using errcode = '23P01'; end if;
    insert into public.booking_option(offer_id,studio_id,artist_profile_id,start_at,end_at,created_at)
    values(v_offer.id,p_studio_id,p_artist_profile_id,v_start,v_end,p_now);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',option.id,'start_at',option.start_at,'end_at',option.end_at,'status',option.status)
    order by option.start_at),'[]'::jsonb) into v_options from public.booking_option option where option.offer_id = v_offer.id;
  return jsonb_build_object('id',v_offer.id,'tattoo_case_id',v_offer.tattoo_case_id,'artist_profile_id',v_offer.artist_profile_id,
    'status',v_offer.status,'expires_at',v_offer.expires_at,'created_at',v_offer.created_at,'options',v_options);
end $$;

create or replace function public.list_active_booking_holds(
  p_studio_id uuid,p_owner_user_id uuid,p_artist_profile_id uuid,p_range_start timestamptz,p_range_end timestamptz,p_now timestamptz)
returns table(start_utc timestamptz,end_utc timestamptz) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_studio_id is null or p_owner_user_id is null or p_artist_profile_id is null or p_range_start is null
    or p_range_end is null or p_now is null or p_range_end <= p_range_start then
    raise exception 'invalid hold range' using errcode = '22023';
  end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then
    raise exception 'artist not found' using errcode = 'P0002';
  end if;
  return query
  select option.start_at, option.end_at
  from public.booking_option option
  join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
  where option.studio_id = p_studio_id and option.artist_profile_id = p_artist_profile_id
    and (
      (option.status = 'HELD' and offer.status = 'OPEN' and offer.expires_at > p_now)
      or (option.status = 'SELECTED' and offer.status = 'SELECTED_PENDING_CONFIRMATION' and (
        offer.expires_at > p_now or exists (
          select 1 from public.booking_confirmation_operation operation
          where operation.booking_offer_id = offer.id and operation.studio_id = offer.studio_id and operation.state = 'INSERTING'
        )))
      or (option.status = 'CONFIRMED' and offer.status = 'CONFIRMED' and exists(
        select 1 from public.appointment appointment
        where appointment.booking_offer_id = offer.id and appointment.booking_option_id = option.id
          and appointment.studio_id = offer.studio_id and appointment.status = 'CONFIRMED'))
    )
    and option.start_at < p_range_end and option.end_at > p_range_start
  order by option.start_at;
end $$;

revoke all on function
  public.expire_booking_offers(uuid,uuid,timestamptz),
  public.begin_public_booking_confirmation_insert(text,uuid,timestamptz),
  public.select_public_booking_offer(text,text,timestamptz),
  public.get_public_booking_offer(text,timestamptz),
  public.get_public_booking_confirmation_context(text,timestamptz),
  public.claim_public_booking_confirmation(text,text,text,timestamptz),
  public.finalize_public_booking_confirmation(text,uuid,uuid,text,text,text,timestamptz),
  public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz),
  public.list_active_booking_holds(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)
from public, anon, authenticated;

grant execute on function
  public.expire_booking_offers(uuid,uuid,timestamptz),
  public.begin_public_booking_confirmation_insert(text,uuid,timestamptz),
  public.select_public_booking_offer(text,text,timestamptz),
  public.get_public_booking_offer(text,timestamptz),
  public.get_public_booking_confirmation_context(text,timestamptz),
  public.claim_public_booking_confirmation(text,text,text,timestamptz),
  public.finalize_public_booking_confirmation(text,uuid,uuid,text,text,text,timestamptz),
  public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz),
  public.list_active_booking_holds(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)
to service_role;
