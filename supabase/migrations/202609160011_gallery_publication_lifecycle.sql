alter table public.gallery_asset
  add constraint gallery_asset_publication_timestamps_check check (
    (status in ('DRAFT','DISCARDED','PUBLISHING') and published_at is null and retired_at is null)
    or (status in ('PUBLISHED','RETIRING') and published_at is not null and retired_at is null)
    or (status='RETIRED' and published_at is not null and retired_at is not null)
  );

create or replace function public.begin_gallery_publish(p_handle uuid)
returns table(
  outcome text,
  publication_key uuid,
  private_display_path text,
  private_display_mime_type text,
  private_display_byte_size integer,
  private_thumb_path text,
  private_thumb_mime_type text,
  private_thumb_byte_size integer,
  public_display_path text,
  public_thumb_path text
)
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_asset_id uuid;
  v_studio_id uuid;
  v_status public.gallery_asset_status;
  v_publication_key uuid;
  v_display_path text;
  v_display_mime text;
  v_display_size integer;
  v_thumb_path text;
  v_thumb_mime text;
  v_thumb_size integer;
begin
  if p_handle is null then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);
  select asset.status into strict v_status from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id for update;

  if v_status='PUBLISHED' then
    return query select 'COMPLETE'::text,null::uuid,null::text,null::text,null::integer,null::text,null::text,null::integer,null::text,null::text;
    return;
  elsif v_status='DRAFT' then
    insert into public.gallery_publication_binding(asset_id,studio_id) values(v_asset_id,v_studio_id)
    returning gallery_publication_binding.publication_key into v_publication_key;
    update public.gallery_asset set status='PUBLISHING',updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='DRAFT';
  elsif v_status='PUBLISHING' then
    select binding.publication_key into strict v_publication_key
    from public.gallery_publication_binding binding
    where binding.asset_id=v_asset_id and binding.studio_id=v_studio_id;
  else
    raise insufficient_privilege using message='gallery publication unavailable';
  end if;

  select variant.object_path,variant.mime_type,variant.byte_size
    into strict v_display_path,v_display_mime,v_display_size
  from public.gallery_variant variant
  where variant.asset_id=v_asset_id and variant.studio_id=v_studio_id and variant.kind='DISPLAY';
  select variant.object_path,variant.mime_type,variant.byte_size
    into strict v_thumb_path,v_thumb_mime,v_thumb_size
  from public.gallery_variant variant
  where variant.asset_id=v_asset_id and variant.studio_id=v_studio_id and variant.kind='THUMB';
  if v_display_mime<>'image/webp' or v_thumb_mime<>'image/webp'
    or v_display_size not between 1 and 10485760 or v_thumb_size not between 1 and 10485760
  then raise insufficient_privilege using message='gallery publication unavailable'; end if;

  return query select 'WORK'::text,v_publication_key,
    v_display_path,v_display_mime,v_display_size,
    v_thumb_path,v_thumb_mime,v_thumb_size,
    v_publication_key::text||'/display.webp',v_publication_key::text||'/thumb.webp';
exception when no_data_found or too_many_rows or insufficient_privilege
  then raise insufficient_privilege using message='gallery publication unavailable';
end; $$;

create or replace function public.finalize_gallery_publish(p_handle uuid,p_publication_key uuid)
returns void language plpgsql volatile security definer set search_path=''
as $$
declare v_asset_id uuid; v_studio_id uuid; v_status public.gallery_asset_status; v_bound_key uuid;
begin
  if p_handle is null or p_publication_key is null then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);
  select asset.status into strict v_status from public.gallery_asset asset where asset.id=v_asset_id and asset.studio_id=v_studio_id for update;
  select binding.publication_key into strict v_bound_key from public.gallery_publication_binding binding where binding.asset_id=v_asset_id and binding.studio_id=v_studio_id;
  if v_bound_key<>p_publication_key or v_status not in ('PUBLISHING','PUBLISHED') then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  if v_status='PUBLISHING' then
    update public.gallery_asset set status='PUBLISHED',published_at=now(),updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='PUBLISHING';
  end if;
exception when no_data_found or too_many_rows or insufficient_privilege
  then raise insufficient_privilege using message='gallery publication unavailable';
end; $$;

create or replace function public.begin_gallery_retire(p_handle uuid)
returns table(outcome text,publication_key uuid,public_display_path text,public_thumb_path text)
language plpgsql volatile security definer set search_path=''
as $$
declare v_asset_id uuid; v_studio_id uuid; v_status public.gallery_asset_status; v_publication_key uuid;
begin
  if p_handle is null then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);
  select asset.status into strict v_status from public.gallery_asset asset where asset.id=v_asset_id and asset.studio_id=v_studio_id for update;
  if v_status='RETIRED' then
    return query select 'COMPLETE'::text,null::uuid,null::text,null::text;
    return;
  elsif v_status='PUBLISHED' then
    update public.gallery_asset set status='RETIRING',updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='PUBLISHED';
  elsif v_status<>'RETIRING' then
    raise insufficient_privilege using message='gallery publication unavailable';
  end if;
  select binding.publication_key into strict v_publication_key from public.gallery_publication_binding binding where binding.asset_id=v_asset_id and binding.studio_id=v_studio_id;
  return query select 'WORK'::text,v_publication_key,v_publication_key::text||'/display.webp',v_publication_key::text||'/thumb.webp';
exception when no_data_found or too_many_rows or insufficient_privilege
  then raise insufficient_privilege using message='gallery publication unavailable';
end; $$;

create or replace function public.finalize_gallery_retire(p_handle uuid,p_publication_key uuid)
returns void language plpgsql volatile security definer set search_path=''
as $$
declare v_asset_id uuid; v_studio_id uuid; v_status public.gallery_asset_status; v_bound_key uuid;
begin
  if p_handle is null or p_publication_key is null then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);
  select asset.status into strict v_status from public.gallery_asset asset where asset.id=v_asset_id and asset.studio_id=v_studio_id for update;
  select binding.publication_key into strict v_bound_key from public.gallery_publication_binding binding where binding.asset_id=v_asset_id and binding.studio_id=v_studio_id;
  if v_bound_key<>p_publication_key or v_status not in ('RETIRING','RETIRED') then raise insufficient_privilege using message='gallery publication unavailable'; end if;
  if v_status='RETIRING' then
    update public.gallery_asset set status='RETIRED',retired_at=now(),updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='RETIRING';
  end if;
exception when no_data_found or too_many_rows or insufficient_privilege
  then raise insufficient_privilege using message='gallery publication unavailable';
end; $$;

create or replace function public.list_gallery_assets_v3(p_studio_id uuid,p_limit integer default 100)
returns table(thumbnail_handle uuid,status text,target text,artist_profile_id uuid,artist_display_name text,alt_text text,"position" integer,width integer,height integer)
language plpgsql stable security definer set search_path=''
as $$ begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value using message='gallery unavailable'; end if;
  return query select asset.public_id,asset.status::text,asset.target::text,asset.artist_profile_id,artist.display_name,asset.alt_text,asset.position,variant.width,variant.height
  from public.gallery_asset asset
  join public.gallery_variant variant on variant.asset_id=asset.id and variant.studio_id=asset.studio_id and variant.kind='THUMB' and variant.mime_type='image/webp'
  left join public.artist_profile artist on artist.id=asset.artist_profile_id and artist.studio_id=asset.studio_id
  where asset.studio_id=p_studio_id and asset.status in ('DRAFT','PUBLISHING','PUBLISHED','RETIRING') and asset.target in ('GALLERY','ARTIST_PORTFOLIO')
  order by asset.target,artist.display_name nulls first,asset.position,asset.created_at,asset.id limit p_limit;
end; $$;

create or replace function public.resolve_gallery_thumbnail(p_handle uuid)
returns table(object_path text,byte_size integer)
language plpgsql stable security definer set search_path=''
as $$
declare v_studio_id uuid;
begin
  if p_handle is null then raise insufficient_privilege using message='thumbnail unavailable'; end if;
  select asset.studio_id into strict v_studio_id from public.gallery_asset asset
  where asset.public_id=p_handle and asset.status in ('DRAFT','PUBLISHING','PUBLISHED','RETIRING') and asset.target in ('GALLERY','ARTIST_PORTFOLIO');
  perform private.assert_authenticated_owner(v_studio_id);
  return query select variant.object_path,variant.byte_size
  from public.gallery_variant variant join public.gallery_asset asset on asset.id=variant.asset_id and asset.studio_id=variant.studio_id
  where asset.public_id=p_handle and asset.status in ('DRAFT','PUBLISHING','PUBLISHED','RETIRING') and variant.kind='THUMB' and variant.mime_type='image/webp';
  if not found then raise insufficient_privilege using message='thumbnail unavailable'; end if;
exception when no_data_found or too_many_rows then raise insufficient_privilege using message='thumbnail unavailable';
end; $$;

revoke all on function public.begin_gallery_publish(uuid), public.finalize_gallery_publish(uuid,uuid), public.begin_gallery_retire(uuid), public.finalize_gallery_retire(uuid,uuid), public.list_gallery_assets_v3(uuid,integer) from public, anon, service_role;
grant execute on function public.begin_gallery_publish(uuid), public.finalize_gallery_publish(uuid,uuid), public.begin_gallery_retire(uuid), public.finalize_gallery_retire(uuid,uuid), public.list_gallery_assets_v3(uuid,integer) to authenticated;
