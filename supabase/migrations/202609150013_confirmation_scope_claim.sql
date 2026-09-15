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
      and granted_scopes @> array[
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
        'https://www.googleapis.com/auth/calendar.events']::text[];
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
      and granted_scopes @> array[
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
        'https://www.googleapis.com/auth/calendar.events']::text[];
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

revoke all on function public.claim_public_booking_confirmation(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_public_booking_confirmation(text,text,text,timestamptz) to service_role;
