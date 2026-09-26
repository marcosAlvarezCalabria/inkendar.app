create or replace function private.assert_authenticated_owner(p_studio_id uuid)
returns void language plpgsql stable security definer set search_path=''
as $$
declare v_user_id uuid := (select auth.uid()); v_count integer;
begin
  if v_user_id is null or p_studio_id is null then raise insufficient_privilege using message='gallery unavailable'; end if;
  select count(*)::integer into v_count from public.membership m
  join public.user_profile p on p.id=m.user_profile_id and p.studio_id=m.studio_id and p.user_id=m.user_id
  where m.user_id=v_user_id and m.studio_id=p_studio_id
    and m.role='OWNER'::public.membership_role
    and m.status='ACTIVE'::public.membership_status;
  if v_count <> 1 or (select count(*) from public.membership where user_id=v_user_id) <> 1 then raise insufficient_privilege using message='gallery unavailable'; end if;
end; $$;
revoke all on function private.assert_authenticated_owner(uuid) from public, anon, authenticated, service_role;

create or replace function private.assert_studio_owner(target_studio_id uuid, target_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.membership
    where studio_id = target_studio_id
      and user_id = target_user_id
      and role = 'OWNER'::public.membership_role
      and status = 'ACTIVE'::public.membership_status
  ) then
    raise exception 'owner authorization failed' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_studio_owner(uuid, uuid) from public, anon, authenticated, service_role;
