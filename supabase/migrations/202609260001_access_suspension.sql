create type public.membership_status as enum ('ACTIVE', 'SUSPENDED');

alter table public.membership
  add column status public.membership_status not null default 'ACTIVE',
  add column access_changed_at timestamptz,
  add column access_changed_by uuid,
  add constraint membership_access_change_pair
    check ((access_changed_at is null) = (access_changed_by is null));

create or replace function private.is_studio_owner(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membership membership
    where membership.studio_id = target_studio_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'OWNER'::public.membership_role
      and membership.status = 'ACTIVE'::public.membership_status
  );
$$;

create or replace function private.is_studio_artist(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membership membership
    where membership.studio_id = target_studio_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'ARTIST'::public.membership_role
      and membership.status = 'ACTIVE'::public.membership_status
  );
$$;

drop policy membership_owner_all on public.membership;
create policy membership_owner_select on public.membership
for select to authenticated
using (private.is_studio_owner(studio_id));

drop policy membership_artist_select_self on public.membership;
create policy membership_artist_select_self on public.membership
for select to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and status = 'ACTIVE'::public.membership_status
);

revoke insert, update, delete on public.membership from authenticated;

create function public.set_artist_access(
  p_membership_id uuid,
  p_status public.membership_status
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_membership_count integer;
  v_active_owner_count integer;
  v_studio_id uuid;
  v_target_user_id uuid;
  v_target_role public.membership_role;
  v_target_status public.membership_status;
begin
  if v_actor is null or p_membership_id is null or p_status is null then
    raise insufficient_privilege using message = 'artist access unavailable';
  end if;

  select count(*)::integer,
         count(*) filter (
           where membership.role = 'OWNER'::public.membership_role
             and membership.status = 'ACTIVE'::public.membership_status
             and profile.id is not null
         )::integer,
         (array_agg(membership.studio_id))[1]
  into v_membership_count, v_active_owner_count, v_studio_id
  from public.membership membership
  left join public.user_profile profile
    on profile.id = membership.user_profile_id
    and profile.studio_id = membership.studio_id
    and profile.user_id = membership.user_id
  where membership.user_id = v_actor;

  if v_membership_count <> 1 or v_active_owner_count <> 1 then
    raise insufficient_privilege using message = 'artist access unavailable';
  end if;

  select membership.user_id, membership.role, membership.status
  into v_target_user_id, v_target_role, v_target_status
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
  where membership.id = p_membership_id
    and membership.studio_id = v_studio_id
  for update of membership;

  if not found or v_target_user_id = v_actor or v_target_role <> 'ARTIST'::public.membership_role then
    raise insufficient_privilege using message = 'artist access unavailable';
  end if;

  if v_target_status <> p_status then
    update public.membership
    set status = p_status,
        access_changed_at = clock_timestamp(),
        access_changed_by = v_actor,
        updated_at = now()
    where id = p_membership_id;
  end if;
end;
$$;

revoke all on function public.set_artist_access(uuid, public.membership_status) from public, anon, service_role;
grant execute on function public.set_artist_access(uuid, public.membership_status) to authenticated;

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
    and membership.role = 'ARTIST'::public.membership_role
    and membership.status = 'ACTIVE'::public.membership_status;

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
    and membership.role = 'ARTIST'::public.membership_role
    and membership.status = 'ACTIVE'::public.membership_status;

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
