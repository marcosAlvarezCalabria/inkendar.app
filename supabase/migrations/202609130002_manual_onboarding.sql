create or replace function public.provision_studio_owner(
  p_user_id uuid,
  p_studio_name text,
  p_display_name text
)
returns table (studio_id uuid, user_profile_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_studio_id uuid;
  new_user_profile_id uuid;
  new_membership_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  select s.id, up.id, m.id
    into new_studio_id, new_user_profile_id, new_membership_id
  from public.membership m
  join public.user_profile up
    on up.id = m.user_profile_id
    and up.studio_id = m.studio_id
    and up.user_id = m.user_id
  join public.studio s on s.id = m.studio_id
  where m.user_id = p_user_id
    and m.role = 'OWNER'::public.membership_role
    and s.name = p_studio_name
    and up.display_name = p_display_name;

  if new_membership_id is not null then
    return query select new_studio_id, new_user_profile_id, new_membership_id;
    return;
  end if;

  if exists (select 1 from public.membership where user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_IDENTITY';
  end if;

  insert into public.studio (name)
  values (p_studio_name)
  returning id into new_studio_id;

  insert into public.user_profile (studio_id, user_id, display_name)
  values (new_studio_id, p_user_id, p_display_name)
  returning id into new_user_profile_id;

  insert into public.membership (studio_id, user_id, user_profile_id, role)
  values (new_studio_id, p_user_id, new_user_profile_id, 'OWNER')
  returning id into new_membership_id;

  return query select new_studio_id, new_user_profile_id, new_membership_id;
end;
$$;

create or replace function public.provision_studio_artist(
  p_user_id uuid,
  p_studio_id uuid,
  p_display_name text
)
returns table (user_profile_id uuid, membership_id uuid, artist_profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_user_profile_id uuid;
  new_membership_id uuid;
  new_artist_profile_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  if not exists (select 1 from public.studio where id = p_studio_id) then
    raise exception using errcode = 'P0001', message = 'STUDIO_NOT_FOUND';
  end if;

  select up.id, m.id, ap.id
    into new_user_profile_id, new_membership_id, new_artist_profile_id
  from public.membership m
  join public.user_profile up
    on up.id = m.user_profile_id
    and up.studio_id = m.studio_id
    and up.user_id = m.user_id
  join public.artist_profile ap
    on ap.membership_id = m.id
    and ap.studio_id = m.studio_id
    and ap.user_id = m.user_id
    and ap.membership_role = m.role
  where m.user_id = p_user_id
    and m.studio_id = p_studio_id
    and m.role = 'ARTIST'::public.membership_role
    and up.display_name = p_display_name
    and ap.display_name = p_display_name;

  if new_artist_profile_id is not null then
    return query select new_user_profile_id, new_membership_id, new_artist_profile_id;
    return;
  end if;

  if exists (select 1 from public.membership where user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_IDENTITY';
  end if;

  insert into public.user_profile (studio_id, user_id, display_name)
  values (p_studio_id, p_user_id, p_display_name)
  returning id into new_user_profile_id;

  insert into public.membership (studio_id, user_id, user_profile_id, role)
  values (p_studio_id, p_user_id, new_user_profile_id, 'ARTIST')
  returning id into new_membership_id;

  insert into public.artist_profile (studio_id, membership_id, user_id, display_name)
  values (p_studio_id, new_membership_id, p_user_id, p_display_name)
  returning id into new_artist_profile_id;

  return query select new_user_profile_id, new_membership_id, new_artist_profile_id;
end;
$$;

revoke all on function public.provision_studio_owner(uuid, text, text) from public, anon, authenticated;
revoke all on function public.provision_studio_artist(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_studio_owner(uuid, text, text) to service_role;
grant execute on function public.provision_studio_artist(uuid, uuid, text) to service_role;
