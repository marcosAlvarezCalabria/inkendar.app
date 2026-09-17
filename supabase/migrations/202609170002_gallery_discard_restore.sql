create or replace function public.list_gallery_discarded_assets(
  p_studio_id uuid,
  p_limit integer default 100
)
returns table(
  handle uuid,
  target text,
  artist_display_name text,
  alt_text text,
  discarded_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise invalid_parameter_value using message='gallery restore invalid';
  end if;

  return query
  select asset.public_id,asset.target::text,artist.display_name,asset.alt_text,asset.updated_at
  from public.gallery_asset asset
  left join public.artist_profile artist
    on artist.id=asset.artist_profile_id and artist.studio_id=asset.studio_id
  where asset.studio_id=p_studio_id
    and asset.status='DISCARDED'
    and asset.target in ('GALLERY','ARTIST_PORTFOLIO')
  order by asset.updated_at desc,asset.created_at desc,asset.public_id
  limit p_limit;
end;
$$;

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
  v_target public.gallery_target;
  v_artist_profile_id uuid;
  v_status public.gallery_asset_status;
  v_position integer;
begin
  if p_handle is null then
    raise insufficient_privilege using message='gallery restore unavailable';
  end if;

  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset
  where asset.public_id=p_handle;

  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);

  select asset.target,asset.artist_profile_id,asset.status
    into strict v_target,v_artist_profile_id,v_status
  from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id
  for update;

  if v_status='DRAFT' then
    return;
  elsif v_status<>'DISCARDED' then
    raise insufficient_privilege using message='gallery restore unavailable';
  end if;

  select coalesce(max(asset.position),0)+1 into v_position
  from public.gallery_asset asset
  where asset.studio_id=v_studio_id
    and asset.target=v_target
    and asset.artist_profile_id is not distinct from v_artist_profile_id;

  update public.gallery_asset
  set status='DRAFT',position=v_position,updated_at=now()
  where id=v_asset_id and studio_id=v_studio_id and status='DISCARDED';
exception
  when no_data_found or too_many_rows or insufficient_privilege
    then raise insufficient_privilege using message='gallery restore unavailable';
end;
$$;

revoke all on function public.list_gallery_discarded_assets(uuid,integer), public.restore_gallery_draft(uuid)
from public, anon, service_role;
grant execute on function public.list_gallery_discarded_assets(uuid,integer), public.restore_gallery_draft(uuid)
to authenticated;
