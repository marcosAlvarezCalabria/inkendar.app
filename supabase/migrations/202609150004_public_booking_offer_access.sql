alter table public.booking_offer
  add constraint booking_offer_id_studio_unique unique (id, studio_id);

create table public.booking_offer_public_access (
  offer_id uuid primary key,
  studio_id uuid not null,
  token_hash bytea not null unique,
  issued_at timestamptz not null,
  updated_at timestamptz not null,
  constraint booking_offer_public_access_hash_length check (octet_length(token_hash) = 32),
  constraint booking_offer_public_access_offer_tenant_fk
    foreign key (offer_id, studio_id)
    references public.booking_offer(id, studio_id)
    on delete cascade
);

alter table public.booking_offer_public_access enable row level security;
revoke all on table public.booking_offer_public_access from public, anon, authenticated, service_role;

create or replace function public.rotate_booking_offer_public_access(
  p_studio_id uuid,
  p_owner_user_id uuid,
  p_offer_id uuid,
  p_token_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.booking_offer;
begin
  if p_studio_id is null or p_owner_user_id is null or p_offer_id is null or p_token_hash is null or p_now is null
    or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid public offer access' using errcode = '22023';
  end if;

  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);

  select offer.* into v_offer
  from public.booking_offer offer
  where offer.id = p_offer_id
    and offer.studio_id = p_studio_id
    and offer.status = 'OPEN'
    and offer.expires_at > p_now
  for update;

  if not found then
    raise exception 'booking offer not found' using errcode = 'P0002';
  end if;

  insert into public.booking_offer_public_access(offer_id, studio_id, token_hash, issued_at, updated_at)
  values (v_offer.id, v_offer.studio_id, pg_catalog.decode(p_token_hash, 'hex'), p_now, p_now)
  on conflict (offer_id) do update
    set token_hash = excluded.token_hash,
        issued_at = excluded.issued_at,
        updated_at = excluded.updated_at;

  return jsonb_build_object('expires_at', v_offer.expires_at);
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
    'expires_at', offer.expires_at,
    'artist_display_name', artist.display_name,
    'time_zone', availability.time_zone,
    'options', (
      select jsonb_agg(
        jsonb_build_object('start_at', option.start_at, 'end_at', option.end_at)
        order by option.start_at
      )
      from public.booking_option option
      where option.offer_id = offer.id
        and option.studio_id = offer.studio_id
        and option.status = 'HELD'
    )
  ) into v_result
  from public.booking_offer_public_access access
  join public.booking_offer offer
    on offer.id = access.offer_id and offer.studio_id = access.studio_id
  join public.artist_profile artist
    on artist.id = offer.artist_profile_id and artist.studio_id = offer.studio_id
  left join public.artist_availability_rule availability
    on availability.artist_profile_id = offer.artist_profile_id and availability.studio_id = offer.studio_id
  where access.token_hash = pg_catalog.decode(p_token_hash, 'hex')
    and offer.status = 'OPEN'
    and offer.expires_at > p_now
    and (select count(*) from public.booking_option option where option.offer_id = offer.id and option.studio_id = offer.studio_id and option.status = 'HELD') between 1 and 3;

  return v_result;
end;
$$;

revoke all on function public.rotate_booking_offer_public_access(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_public_booking_offer(text, timestamptz) from public, anon, authenticated;
grant execute on function public.rotate_booking_offer_public_access(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.get_public_booking_offer(text, timestamptz) to service_role;
