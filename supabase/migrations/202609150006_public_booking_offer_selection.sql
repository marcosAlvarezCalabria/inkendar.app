create or replace function public.create_booking_offer(p_studio_id uuid, p_owner_user_id uuid, p_tattoo_case_id uuid, p_artist_profile_id uuid, p_options jsonb, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_offer public.booking_offer; v_option jsonb; v_start timestamptz; v_end timestamptz; v_options jsonb;
begin
  if p_studio_id is null or p_owner_user_id is null or p_tattoo_case_id is null or p_artist_profile_id is null or p_options is null or p_now is null
    or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 3 then raise exception 'invalid booking offer' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.tattoo_case where id = p_tattoo_case_id and studio_id = p_studio_id and status = 'OPEN')
    or not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then raise exception 'booking context not found' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text || ':' || p_artist_profile_id::text, 0));
  insert into public.booking_offer(studio_id, tattoo_case_id, artist_profile_id, expires_at, created_at, updated_at)
    select p_studio_id, p_tattoo_case_id, p_artist_profile_id, p_now + pg_catalog.make_interval(hours => s.booking_offer_expiry_hours), p_now, p_now from public.studio s where s.id = p_studio_id returning * into v_offer;
  for v_option in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_option) <> 'object' or (select count(*) from jsonb_object_keys(v_option)) <> 2
      or jsonb_typeof(v_option -> 'startUtc') <> 'string' or jsonb_typeof(v_option -> 'endUtc') <> 'string' then raise exception 'invalid booking option' using errcode = '22023'; end if;
    begin v_start := (v_option ->> 'startUtc')::timestamptz; v_end := (v_option ->> 'endUtc')::timestamptz; exception when others then raise exception 'invalid booking option' using errcode = '22023'; end;
    if v_start <= p_now or v_end <= v_start or extract(epoch from (v_end - v_start)) / 60 not between 15 and 480 then raise exception 'invalid booking option' using errcode = '22023'; end if;
    if exists(
      select 1
      from public.booking_option option
      join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
      where option.studio_id = p_studio_id
        and option.artist_profile_id = p_artist_profile_id
        and offer.expires_at > p_now
        and (
          (option.status = 'HELD' and offer.status = 'OPEN')
          or (option.status = 'SELECTED' and offer.status = 'SELECTED_PENDING_CONFIRMATION')
        )
        and option.start_at < v_end
        and option.end_at > v_start
    ) then raise exception 'booking hold conflict' using errcode = '23P01'; end if;
    insert into public.booking_option(offer_id, studio_id, artist_profile_id, start_at, end_at, created_at) values(v_offer.id, p_studio_id, p_artist_profile_id, v_start, v_end, p_now);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', option.id, 'start_at', option.start_at, 'end_at', option.end_at, 'status', option.status) order by option.start_at), '[]'::jsonb) into v_options from public.booking_option option where option.offer_id = v_offer.id;
  return jsonb_build_object('id', v_offer.id, 'tattoo_case_id', v_offer.tattoo_case_id, 'artist_profile_id', v_offer.artist_profile_id, 'status', v_offer.status, 'expires_at', v_offer.expires_at, 'created_at', v_offer.created_at, 'options', v_options);
end $$;

create or replace function public.select_public_booking_offer(
  p_token_hash text,
  p_option_selector text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.booking_offer;
  v_option public.booking_option;
begin
  if p_token_hash is null or p_option_selector is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_option_selector !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid public offer selection' using errcode = '22023';
  end if;

  select offer.* into v_offer
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
    and offer.expires_at > p_now
  for update of offer;

  if not found then
    raise exception 'public booking offer unavailable' using errcode = 'P0002';
  end if;

  if v_offer.status = 'OPEN' then
    select option.* into v_option
    from public.booking_option option
    where option.offer_id = v_offer.id
      and option.studio_id = v_offer.studio_id
      and option.public_selector = p_option_selector::uuid
      and option.status = 'HELD'
    for update;

    if not found then
      raise exception 'public booking offer selection rejected' using errcode = 'P0003';
    end if;

    update public.booking_offer
    set status = 'SELECTED_PENDING_CONFIRMATION', updated_at = p_now
    where id = v_offer.id and studio_id = v_offer.studio_id;

    update public.booking_option
    set status = case when id = v_option.id then 'SELECTED'::public.booking_option_status else 'RELEASED'::public.booking_option_status end
    where offer_id = v_offer.id and studio_id = v_offer.studio_id and status = 'HELD';
  else
    select option.* into v_option
    from public.booking_option option
    where option.offer_id = v_offer.id
      and option.studio_id = v_offer.studio_id
      and option.status = 'SELECTED';

    if not found or v_option.public_selector <> p_option_selector::uuid then
      raise exception 'public booking offer selection rejected' using errcode = 'P0003';
    end if;
  end if;

  return jsonb_build_object('state', 'SELECTION_PENDING_CONFIRMATION');
end;
$$;

create or replace function public.get_public_booking_offer(
  p_token_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_token_hash is null or p_now is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid public offer access' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'state', case when offer.status = 'OPEN' then 'OPEN' else 'SELECTION_PENDING_CONFIRMATION' end,
    'expires_at', offer.expires_at,
    'artist_display_name', artist.display_name,
    'time_zone', availability.time_zone,
    'options', (
      select jsonb_agg(
        case when offer.status = 'OPEN'
          then jsonb_build_object('selector', option.public_selector::text, 'start_at', option.start_at, 'end_at', option.end_at)
          else jsonb_build_object('start_at', option.start_at, 'end_at', option.end_at)
        end
        order by option.start_at
      )
      from public.booking_option option
      where option.offer_id = offer.id
        and option.studio_id = offer.studio_id
        and (
          (offer.status = 'OPEN' and option.status = 'HELD')
          or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and option.status = 'SELECTED')
        )
    )
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.artist_profile artist on artist.id = offer.artist_profile_id and artist.studio_id = offer.studio_id
  left join public.artist_availability_rule availability on availability.artist_profile_id = offer.artist_profile_id and availability.studio_id = offer.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
    and offer.expires_at > p_now
    and (
      (offer.status = 'OPEN' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.studio_id = offer.studio_id and option.status = 'HELD') between 1 and 3)
      or (offer.status = 'SELECTED_PENDING_CONFIRMATION' and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.studio_id = offer.studio_id and option.status = 'SELECTED') = 1)
    );

  return v_result;
end;
$$;

create or replace function public.expire_booking_offers(p_studio_id uuid, p_owner_user_id uuid, p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_studio_id is null or p_owner_user_id is null or p_now is null then raise exception 'invalid expiry request' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  with expired as (
    update public.booking_offer
    set status = 'EXPIRED', updated_at = p_now
    where studio_id = p_studio_id and status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION') and expires_at <= p_now
    returning id
  ), released as (
    update public.booking_option
    set status = 'RELEASED'
    where studio_id = p_studio_id and status in ('HELD', 'SELECTED') and offer_id in (select id from expired)
    returning offer_id
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end $$;

create or replace function public.list_active_booking_holds(p_studio_id uuid, p_owner_user_id uuid, p_artist_profile_id uuid, p_range_start timestamptz, p_range_end timestamptz, p_now timestamptz)
returns table(start_utc timestamptz, end_utc timestamptz) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_studio_id is null or p_owner_user_id is null or p_artist_profile_id is null or p_range_start is null or p_range_end is null or p_now is null or p_range_end <= p_range_start then raise exception 'invalid hold range' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then raise exception 'artist not found' using errcode = 'P0002'; end if;
  return query
  select option.start_at, option.end_at
  from public.booking_option option
  join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
  where option.studio_id = p_studio_id
    and option.artist_profile_id = p_artist_profile_id
    and offer.expires_at > p_now
    and (
      (option.status = 'HELD' and offer.status = 'OPEN')
      or (option.status = 'SELECTED' and offer.status = 'SELECTED_PENDING_CONFIRMATION')
    )
    and option.start_at < p_range_end
    and option.end_at > p_range_start
  order by option.start_at;
end $$;

revoke all on function public.select_public_booking_offer(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.select_public_booking_offer(text, text, timestamptz) to service_role;
