create or replace function public.list_gallery_drafts_v2(p_studio_id uuid,p_limit integer default 100)
returns table(thumbnail_handle uuid,target text,artist_display_name text,alt_text text,"position" integer,width integer,height integer)
language plpgsql stable security definer set search_path=''
as $$ begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  return query select asset.public_id,asset.target::text,artist.display_name,asset.alt_text,asset.position,variant.width,variant.height
  from public.gallery_asset asset
  join public.gallery_variant variant on variant.asset_id=asset.id and variant.studio_id=asset.studio_id and variant.kind='THUMB' and variant.mime_type='image/webp'
  left join public.artist_profile artist on artist.id=asset.artist_profile_id and artist.studio_id=asset.studio_id
  where asset.studio_id=p_studio_id and asset.status='DRAFT' and asset.target in ('GALLERY','ARTIST_PORTFOLIO')
  order by asset.target,artist.display_name nulls first,asset.position,asset.created_at,asset.id limit p_limit;
end; $$;

revoke all on function public.list_gallery_drafts(uuid,integer) from authenticated;
revoke all on function public.list_gallery_drafts_v2(uuid,integer) from public, anon, service_role;
grant execute on function public.list_gallery_drafts_v2(uuid,integer) to authenticated;
