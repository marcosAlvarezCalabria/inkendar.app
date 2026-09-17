create or replace function public.restore_gallery_draft(p_handle uuid)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_asset_id uuid;
  v_studio_id uuid;
  v_status public.gallery_asset_status;
begin
  if p_handle is null then
    raise insufficient_privilege using message='gallery restore unavailable';
  end if;

  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset
  where asset.public_id=p_handle;

  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);

  select asset.status into strict v_status
  from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id
  for update;

  if v_status='DRAFT' then
    return;
  elsif v_status<>'DISCARDED' then
    raise insufficient_privilege using message='gallery restore unavailable';
  end if;

  update public.gallery_asset
  set status='DRAFT',updated_at=now()
  where id=v_asset_id and studio_id=v_studio_id and status='DISCARDED';
exception
  when no_data_found or too_many_rows or insufficient_privilege
    then raise insufficient_privilege using message='gallery restore unavailable';
end;
$$;

revoke all on function public.restore_gallery_draft(uuid)
from public, anon, service_role;
grant execute on function public.restore_gallery_draft(uuid)
to authenticated;
