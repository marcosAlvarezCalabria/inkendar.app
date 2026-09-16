create or replace function public.resolve_gallery_thumbnail(p_handle uuid)
returns table(object_path text, byte_size integer)
language plpgsql stable security definer set search_path=''
as $$
declare v_studio_id uuid;
begin
  if p_handle is null then raise insufficient_privilege using message='thumbnail unavailable'; end if;
  select asset.studio_id into strict v_studio_id
  from public.gallery_asset asset
  where asset.public_id=p_handle and asset.status='DRAFT' and asset.target in ('GALLERY','ARTIST_PORTFOLIO');
  perform private.assert_authenticated_owner(v_studio_id);
  return query select variant.object_path,variant.byte_size
  from public.gallery_variant variant join public.gallery_asset asset on asset.id=variant.asset_id and asset.studio_id=variant.studio_id
  where asset.public_id=p_handle and asset.status='DRAFT' and variant.kind='THUMB' and variant.mime_type='image/webp';
  if not found then raise insufficient_privilege using message='thumbnail unavailable'; end if;
exception when no_data_found or too_many_rows then raise insufficient_privilege using message='thumbnail unavailable';
end; $$;

revoke all on function public.resolve_gallery_thumbnail(uuid) from public, anon, service_role;
grant execute on function public.resolve_gallery_thumbnail(uuid) to authenticated;
