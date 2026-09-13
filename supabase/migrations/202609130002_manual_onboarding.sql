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
  if not exists (select 1 from public.studio where id = p_studio_id) then
    raise exception using errcode = 'P0001', message = 'STUDIO_NOT_FOUND';
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
