create or replace function private.materialize_expired_booking_offers(
  p_studio_id uuid,
  p_artist_profile_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_offer_id uuid;
  v_operation_state text;
begin
  if p_studio_id is null or p_now is null then
    raise exception 'invalid expiry request' using errcode = '22023';
  end if;

  for v_offer_id in
    select offer.id
    from public.booking_offer offer
    where offer.studio_id = p_studio_id
      and (p_artist_profile_id is null or offer.artist_profile_id = p_artist_profile_id)
      and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
      and offer.expires_at <= p_now
    order by offer.id
    for update of offer
  loop
    v_operation_state := null;
    select operation.state::text into v_operation_state
    from public.booking_confirmation_operation operation
    where operation.booking_offer_id = v_offer_id
      and operation.studio_id = p_studio_id
    for update of operation;

    if v_operation_state = 'INSERTING' then
      continue;
    end if;

    update public.booking_offer
    set status = 'EXPIRED', updated_at = p_now
    where id = v_offer_id
      and studio_id = p_studio_id
      and status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
      and expires_at <= p_now;
    if found then
      update public.booking_option
      set status = 'RELEASED'
      where offer_id = v_offer_id
        and studio_id = p_studio_id
        and status in ('HELD', 'SELECTED');
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

create or replace function public.expire_booking_offers(
  p_studio_id uuid,
  p_owner_user_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_studio_id is null or p_owner_user_id is null or p_now is null then
    raise exception 'invalid expiry request' using errcode = '22023';
  end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  return private.materialize_expired_booking_offers(p_studio_id, null, p_now);
end $$;

create or replace function public.create_booking_offer(
  p_studio_id uuid,
  p_owner_user_id uuid,
  p_tattoo_case_id uuid,
  p_artist_profile_id uuid,
  p_options jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.booking_offer;
  v_option jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_options jsonb;
begin
  if p_studio_id is null or p_owner_user_id is null or p_tattoo_case_id is null or p_artist_profile_id is null
    or p_options is null or p_now is null or jsonb_typeof(p_options) <> 'array'
    or jsonb_array_length(p_options) not between 1 and 3 then
    raise exception 'invalid booking offer' using errcode = '22023';
  end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(
    select 1 from public.tattoo_case
    where id = p_tattoo_case_id and studio_id = p_studio_id and status = 'OPEN'
  ) or not exists(
    select 1 from public.artist_profile
    where id = p_artist_profile_id and studio_id = p_studio_id
  ) then
    raise exception 'booking context not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_studio_id::text || ':' || p_artist_profile_id::text, 0)
  );
  perform private.materialize_expired_booking_offers(p_studio_id, p_artist_profile_id, p_now);

  insert into public.booking_offer(studio_id,tattoo_case_id,artist_profile_id,expires_at,created_at,updated_at)
  select p_studio_id,p_tattoo_case_id,p_artist_profile_id,
    p_now + pg_catalog.make_interval(hours => studio.booking_offer_expiry_hours),p_now,p_now
  from public.studio studio
  where studio.id = p_studio_id
  returning * into v_offer;

  for v_option in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_option) <> 'object'
      or (select count(*) from jsonb_object_keys(v_option)) <> 2
      or jsonb_typeof(v_option -> 'startUtc') <> 'string'
      or jsonb_typeof(v_option -> 'endUtc') <> 'string' then
      raise exception 'invalid booking option' using errcode = '22023';
    end if;
    begin
      v_start := (v_option ->> 'startUtc')::timestamptz;
      v_end := (v_option ->> 'endUtc')::timestamptz;
    exception when others then
      raise exception 'invalid booking option' using errcode = '22023';
    end;
    if v_start <= p_now or v_end <= v_start
      or extract(epoch from (v_end - v_start)) / 60 not between 15 and 480 then
      raise exception 'invalid booking option' using errcode = '22023';
    end if;

    if exists(
      select 1
      from public.booking_option option
      join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
      where option.studio_id = p_studio_id
        and option.artist_profile_id = p_artist_profile_id
        and (
          (option.status = 'HELD' and offer.status = 'OPEN' and offer.expires_at > p_now)
          or (option.status = 'SELECTED' and offer.status = 'SELECTED_PENDING_CONFIRMATION' and (
            offer.expires_at > p_now or exists (
              select 1
              from public.booking_confirmation_operation operation
              where operation.booking_offer_id = offer.id
                and operation.studio_id = offer.studio_id
                and operation.state = 'INSERTING'
            )
          ))
          or (option.status = 'CONFIRMED' and offer.status = 'CONFIRMED' and exists(
            select 1
            from public.appointment appointment
            where appointment.booking_offer_id = offer.id
              and appointment.booking_option_id = option.id
              and appointment.studio_id = offer.studio_id
              and appointment.status = 'CONFIRMED'
          ))
        )
        and option.start_at < v_end
        and option.end_at > v_start
    ) then
      raise exception 'booking hold conflict' using errcode = '23P01';
    end if;

    insert into public.booking_option(offer_id,studio_id,artist_profile_id,start_at,end_at,created_at)
    values(v_offer.id,p_studio_id,p_artist_profile_id,v_start,v_end,p_now);
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',option.id,'start_at',option.start_at,'end_at',option.end_at,'status',option.status)
    order by option.start_at
  ),'[]'::jsonb)
  into v_options
  from public.booking_option option
  where option.offer_id = v_offer.id;

  return jsonb_build_object(
    'id',v_offer.id,
    'tattoo_case_id',v_offer.tattoo_case_id,
    'artist_profile_id',v_offer.artist_profile_id,
    'status',v_offer.status,
    'expires_at',v_offer.expires_at,
    'created_at',v_offer.created_at,
    'options',v_options
  );
end $$;

revoke all on function private.materialize_expired_booking_offers(uuid,uuid,timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.expire_booking_offers(uuid,uuid,timestamptz),
  public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.expire_booking_offers(uuid,uuid,timestamptz),
  public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz)
to service_role;
