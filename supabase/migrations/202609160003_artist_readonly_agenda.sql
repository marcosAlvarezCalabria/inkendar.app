create or replace function public.get_artist_agenda(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  start_at timestamptz,
  end_at timestamptz,
  customer_display_name text,
  case_summary text,
  body_area text,
  size text,
  time_zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_membership_count integer;
  v_artist_count integer;
  v_studio_id uuid;
  v_artist_profile_id uuid;
begin
  if v_user_id is null or p_now is null or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise insufficient_privilege using message = 'artist agenda unavailable';
  end if;

  select count(*)::integer
  into v_membership_count
  from public.membership membership
  where membership.user_id = v_user_id;

  select count(*)::integer
  into v_artist_count
  from public.membership membership
  join public.user_profile profile
    on profile.id = membership.user_profile_id
    and profile.studio_id = membership.studio_id
    and profile.user_id = membership.user_id
  join public.artist_profile artist
    on artist.membership_id = membership.id
    and artist.studio_id = membership.studio_id
    and artist.user_id = membership.user_id
    and artist.membership_role = membership.role
  where membership.user_id = v_user_id
    and membership.role = 'ARTIST'::public.membership_role;

  if v_membership_count <> 1 or v_artist_count <> 1 then
    raise insufficient_privilege using message = 'artist agenda unavailable';
  end if;

  select membership.studio_id, artist.id
  into strict v_studio_id, v_artist_profile_id
  from public.membership membership
  join public.user_profile profile
    on profile.id = membership.user_profile_id
    and profile.studio_id = membership.studio_id
    and profile.user_id = membership.user_id
  join public.artist_profile artist
    on artist.membership_id = membership.id
    and artist.studio_id = membership.studio_id
    and artist.user_id = membership.user_id
    and artist.membership_role = membership.role
  where membership.user_id = v_user_id
    and membership.role = 'ARTIST'::public.membership_role;

  return query
  select
    option.start_at,
    option.end_at,
    customer.name,
    tattoo.summary,
    tattoo.body_area,
    tattoo.size,
    coalesce(availability.time_zone, 'UTC'::text)
  from public.appointment appointment
  join public.booking_option option
    on option.id = appointment.booking_option_id
    and option.offer_id = appointment.booking_offer_id
    and option.studio_id = appointment.studio_id
    and option.artist_profile_id = appointment.artist_profile_id
  join public.tattoo_case tattoo
    on tattoo.id = appointment.tattoo_case_id
    and tattoo.studio_id = appointment.studio_id
  join public.customer customer
    on customer.id = tattoo.customer_id
    and customer.studio_id = tattoo.studio_id
  left join public.artist_availability_rule availability
    on availability.artist_profile_id = appointment.artist_profile_id
    and availability.studio_id = appointment.studio_id
  where appointment.studio_id = v_studio_id
    and appointment.artist_profile_id = v_artist_profile_id
    and appointment.status = 'CONFIRMED'::public.appointment_status
    and option.status = 'CONFIRMED'::public.booking_option_status
    and option.end_at >= greatest(p_now, now())
  order by option.start_at, option.end_at, appointment.id
  limit p_limit;
exception
  when no_data_found or too_many_rows then
    raise insufficient_privilege using message = 'artist agenda unavailable';
end;
$$;

revoke all on function public.get_artist_agenda(timestamptz, integer) from public, anon, service_role;
grant execute on function public.get_artist_agenda(timestamptz, integer) to authenticated;
