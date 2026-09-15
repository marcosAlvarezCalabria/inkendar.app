alter table public.studio add column booking_offer_expiry_hours smallint not null default 24 check (booking_offer_expiry_hours > 0);

create type public.booking_offer_status as enum ('OPEN', 'EXPIRED');
create type public.booking_option_status as enum ('HELD', 'RELEASED');

create table public.booking_offer (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  tattoo_case_id uuid not null,
  artist_profile_id uuid not null,
  status public.booking_offer_status not null default 'OPEN',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_offer_case_same_studio_fk foreign key (tattoo_case_id, studio_id) references public.tattoo_case(id, studio_id) on delete restrict,
  constraint booking_offer_artist_same_studio_fk foreign key (artist_profile_id, studio_id) references public.artist_profile(id, studio_id) on delete restrict,
  constraint booking_offer_identity_unique unique (id, studio_id, artist_profile_id)
);

create table public.booking_option (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null,
  studio_id uuid not null,
  artist_profile_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.booking_option_status not null default 'HELD',
  created_at timestamptz not null default now(),
  constraint booking_option_positive_interval check (start_at < end_at),
  constraint booking_option_offer_same_tenant_fk foreign key (offer_id, studio_id, artist_profile_id) references public.booking_offer(id, studio_id, artist_profile_id) on delete restrict,
  constraint booking_option_identity_unique unique (id, studio_id)
);

create index booking_offer_studio_created_idx on public.booking_offer(studio_id, created_at desc);
create index booking_option_active_hold_idx on public.booking_option(studio_id, artist_profile_id, start_at, end_at) where status = 'HELD';

alter table public.booking_offer enable row level security;
alter table public.booking_option enable row level security;
revoke all on table public.booking_offer, public.booking_option from public, anon, authenticated, service_role;

create or replace function public.save_booking_offer_expiry_hours(p_studio_id uuid, p_owner_user_id uuid, p_expiry_hours integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_studio_id is null or p_owner_user_id is null or p_expiry_hours is null or p_expiry_hours < 1 or p_expiry_hours > 32767 then raise exception 'invalid booking expiry' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  update public.studio set booking_offer_expiry_hours = p_expiry_hours where id = p_studio_id;
end $$;

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
    if exists(select 1 from public.booking_option option join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
      where option.studio_id = p_studio_id and option.artist_profile_id = p_artist_profile_id and option.status = 'HELD' and offer.status = 'OPEN' and offer.expires_at > p_now and option.start_at < v_end and option.end_at > v_start)
      then raise exception 'booking hold conflict' using errcode = '23P01'; end if;
    insert into public.booking_option(offer_id, studio_id, artist_profile_id, start_at, end_at, created_at) values(v_offer.id, p_studio_id, p_artist_profile_id, v_start, v_end, p_now);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', option.id, 'start_at', option.start_at, 'end_at', option.end_at, 'status', option.status) order by option.start_at), '[]'::jsonb) into v_options from public.booking_option option where option.offer_id = v_offer.id;
  return jsonb_build_object('id', v_offer.id, 'tattoo_case_id', v_offer.tattoo_case_id, 'artist_profile_id', v_offer.artist_profile_id, 'status', v_offer.status, 'expires_at', v_offer.expires_at, 'created_at', v_offer.created_at, 'options', v_options);
end $$;

create or replace function public.expire_booking_offers(p_studio_id uuid, p_owner_user_id uuid, p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_studio_id is null or p_owner_user_id is null or p_now is null then raise exception 'invalid expiry request' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  with expired as (update public.booking_offer set status = 'EXPIRED', updated_at = p_now where studio_id = p_studio_id and status = 'OPEN' and expires_at <= p_now returning id),
  released as (update public.booking_option set status = 'RELEASED' where studio_id = p_studio_id and status = 'HELD' and offer_id in (select id from expired) returning offer_id)
  select count(*)::integer into v_count from expired;
  return v_count;
end $$;

create or replace function public.list_active_booking_holds(p_studio_id uuid, p_owner_user_id uuid, p_artist_profile_id uuid, p_range_start timestamptz, p_range_end timestamptz, p_now timestamptz)
returns table(start_utc timestamptz, end_utc timestamptz) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_studio_id is null or p_owner_user_id is null or p_artist_profile_id is null or p_range_start is null or p_range_end is null or p_now is null or p_range_end <= p_range_start then raise exception 'invalid hold range' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id) then raise exception 'artist not found' using errcode = 'P0002'; end if;
  return query select option.start_at, option.end_at from public.booking_option option join public.booking_offer offer on offer.id = option.offer_id and offer.studio_id = option.studio_id
    where option.studio_id = p_studio_id and option.artist_profile_id = p_artist_profile_id and option.status = 'HELD' and offer.status = 'OPEN' and offer.expires_at > p_now and option.start_at < p_range_end and option.end_at > p_range_start order by option.start_at;
end $$;

create or replace function public.get_booking_offer_management(p_studio_id uuid, p_owner_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_studio_id is null or p_owner_user_id is null then raise exception 'invalid booking management request' using errcode = '22023'; end if;
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  select jsonb_build_object(
    'expiry_hours', studio.booking_offer_expiry_hours,
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', tattoo.id, 'summary', tattoo.summary, 'artist_profile_id', tattoo.artist_profile_id) order by tattoo.created_at) from public.tattoo_case tattoo where tattoo.studio_id = p_studio_id and tattoo.status = 'OPEN'), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(jsonb_build_object('id', artist.id, 'display_name', artist.display_name) order by artist.display_name) from public.artist_profile artist where artist.studio_id = p_studio_id), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', offer.id, 'tattoo_case_id', offer.tattoo_case_id, 'artist_profile_id', offer.artist_profile_id, 'status', offer.status, 'expires_at', offer.expires_at, 'created_at', offer.created_at, 'options', coalesce((select jsonb_agg(jsonb_build_object('id', option.id, 'start_at', option.start_at, 'end_at', option.end_at, 'status', option.status) order by option.start_at) from public.booking_option option where option.offer_id = offer.id), '[]'::jsonb)) order by offer.created_at desc) from public.booking_offer offer where offer.studio_id = p_studio_id), '[]'::jsonb)
  ) into v_result from public.studio studio where studio.id = p_studio_id;
  if v_result is null then raise exception 'studio not found' using errcode = 'P0002'; end if;
  return v_result;
end $$;

revoke all on function public.save_booking_offer_expiry_hours(uuid,uuid,integer), public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz), public.expire_booking_offers(uuid,uuid,timestamptz), public.list_active_booking_holds(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz), public.get_booking_offer_management(uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_booking_offer_expiry_hours(uuid,uuid,integer), public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz), public.expire_booking_offers(uuid,uuid,timestamptz), public.list_active_booking_holds(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz), public.get_booking_offer_management(uuid,uuid) to service_role;
