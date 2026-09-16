create or replace function private.lock_gallery_studio(p_studio_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $$
begin
  if p_studio_id is null then raise invalid_parameter_value using message='gallery lock invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gallery:'||p_studio_id::text,0));
end;
$$;

revoke all on function private.lock_gallery_studio(uuid) from public, anon, authenticated, service_role;

create or replace function public.create_gallery_draft(p_studio_id uuid,p_asset_id uuid,p_target text,p_artist_profile_id uuid,p_alt_text text,p_variants jsonb)
returns uuid language plpgsql volatile security definer set search_path=''
as $$
declare v_target public.gallery_target; v_position integer; v_variant jsonb; v_kinds integer;
begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_asset_id is null or p_target not in ('GALLERY','ARTIST_PORTFOLIO') or p_alt_text is null or char_length(p_alt_text) not between 1 and 160 or p_alt_text<>btrim(p_alt_text) or p_variants is null or jsonb_typeof(p_variants)<>'array' or jsonb_array_length(p_variants)<>3 or (p_target='GALLERY')<>(p_artist_profile_id is null) then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  if p_artist_profile_id is not null and not exists(select 1 from public.artist_profile where id=p_artist_profile_id and studio_id=p_studio_id) then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  select count(distinct item->>'kind') into v_kinds from jsonb_array_elements(p_variants) item where item->>'kind' in ('MASTER','DISPLAY','THUMB');
  if v_kinds<>3 then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  v_target:=p_target::public.gallery_target;
  perform private.lock_gallery_studio(p_studio_id);
  select coalesce(max(position),0)+1 into v_position from public.gallery_asset where studio_id=p_studio_id and target=v_target and artist_profile_id is not distinct from p_artist_profile_id;
  insert into public.gallery_asset(id,studio_id,target,artist_profile_id,alt_text,position) values(p_asset_id,p_studio_id,v_target,p_artist_profile_id,p_alt_text,v_position);
  for v_variant in select value from jsonb_array_elements(p_variants) loop
    if (select count(*) from jsonb_object_keys(v_variant))<>6 or (v_variant->>'path')<>p_studio_id::text||'/'||p_asset_id::text||'/'||lower(v_variant->>'kind')||'.webp' then raise invalid_parameter_value using message='gallery draft invalid'; end if;
    insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values(p_asset_id,p_studio_id,(v_variant->>'kind')::public.gallery_variant_kind,v_variant->>'path',(v_variant->>'width')::integer,(v_variant->>'height')::integer,v_variant->>'mime_type',(v_variant->>'byte_size')::integer);
  end loop;
  return p_asset_id;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise invalid_parameter_value using message='gallery draft invalid';
end;
$$;

create or replace function public.update_gallery_draft(
  p_handle uuid,
  p_alt_text text,
  p_target text,
  p_artist_profile_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_asset_id uuid;
  v_studio_id uuid;
  v_old_target public.gallery_target;
  v_old_artist_profile_id uuid;
  v_status public.gallery_asset_status;
  v_target public.gallery_target;
  v_position integer;
begin
  if p_handle is null then raise insufficient_privilege using message='gallery draft unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  if p_target not in ('GALLERY','ARTIST_PORTFOLIO')
    or p_alt_text is null
    or char_length(p_alt_text) not between 1 and 160
    or p_alt_text<>regexp_replace(btrim(p_alt_text),'[[:space:]]+',' ','g')
    or (p_target='GALLERY')<>(p_artist_profile_id is null)
  then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  if p_artist_profile_id is not null and not exists(
    select 1 from public.artist_profile artist
    where artist.id=p_artist_profile_id and artist.studio_id=v_studio_id
  ) then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  v_target:=p_target::public.gallery_target;
  perform private.lock_gallery_studio(v_studio_id);
  select asset.target,asset.artist_profile_id,asset.status
    into strict v_old_target,v_old_artist_profile_id,v_status
  from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id
  for update;
  if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;

  if v_old_target=v_target and v_old_artist_profile_id is not distinct from p_artist_profile_id then
    update public.gallery_asset set alt_text=p_alt_text,updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='DRAFT';
  else
    select coalesce(max(asset.position),0)+1 into v_position
    from public.gallery_asset asset
    where asset.studio_id=v_studio_id and asset.target=v_target
      and asset.artist_profile_id is not distinct from p_artist_profile_id;
    update public.gallery_asset
    set target=v_target,artist_profile_id=p_artist_profile_id,alt_text=p_alt_text,position=v_position,updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='DRAFT';
  end if;
exception
  when no_data_found or too_many_rows or insufficient_privilege
    then raise insufficient_privilege using message='gallery draft unavailable';
end;
$$;

create or replace function public.move_gallery_draft(p_handle uuid,p_direction text)
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
  v_neighbor_id uuid;
  v_neighbor_position integer;
begin
  if p_handle is null then raise insufficient_privilege using message='gallery draft unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  if p_direction not in ('MOVE_UP','MOVE_DOWN') then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  perform private.lock_gallery_studio(v_studio_id);
  select asset.target,asset.artist_profile_id,asset.status,asset.position
    into strict v_target,v_artist_profile_id,v_status,v_position
  from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id
  for update;
  if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;

  if p_direction='MOVE_UP' then
    select asset.id,asset.position into v_neighbor_id,v_neighbor_position
    from public.gallery_asset asset
    where asset.studio_id=v_studio_id and asset.target=v_target
      and asset.artist_profile_id is not distinct from v_artist_profile_id
      and asset.status='DRAFT' and asset.position<v_position
    order by asset.position desc,asset.created_at desc,asset.id desc limit 1 for update;
  else
    select asset.id,asset.position into v_neighbor_id,v_neighbor_position
    from public.gallery_asset asset
    where asset.studio_id=v_studio_id and asset.target=v_target
      and asset.artist_profile_id is not distinct from v_artist_profile_id
      and asset.status='DRAFT' and asset.position>v_position
    order by asset.position,asset.created_at,asset.id limit 1 for update;
  end if;
  if v_neighbor_id is null then return; end if;
  set constraints public.gallery_asset_position_unique deferred;
  update public.gallery_asset
  set position=case when id=v_asset_id then v_neighbor_position else v_position end,updated_at=now()
  where studio_id=v_studio_id and id in (v_asset_id,v_neighbor_id);
exception
  when no_data_found or too_many_rows or insufficient_privilege
    then raise insufficient_privilege using message='gallery draft unavailable';
end;
$$;

create or replace function public.discard_gallery_draft(p_handle uuid)
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
  if p_handle is null then raise insufficient_privilege using message='gallery draft unavailable'; end if;
  select asset.id,asset.studio_id into strict v_asset_id,v_studio_id
  from public.gallery_asset asset where asset.public_id=p_handle;
  perform private.assert_authenticated_owner(v_studio_id);
  perform private.lock_gallery_studio(v_studio_id);
  select asset.status into strict v_status from public.gallery_asset asset
  where asset.id=v_asset_id and asset.studio_id=v_studio_id for update;
  if v_status='DRAFT' then
    update public.gallery_asset set status='DISCARDED',updated_at=now()
    where id=v_asset_id and studio_id=v_studio_id and status='DRAFT';
  elsif v_status<>'DISCARDED' then
    raise insufficient_privilege using message='gallery draft unavailable';
  end if;
exception
  when no_data_found or too_many_rows or insufficient_privilege
    then raise insufficient_privilege using message='gallery draft unavailable';
end;
$$;

revoke all on function public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb), public.update_gallery_draft(uuid,text,text,uuid), public.move_gallery_draft(uuid,text), public.discard_gallery_draft(uuid) from public, anon, service_role;
grant execute on function public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb), public.update_gallery_draft(uuid,text,text,uuid), public.move_gallery_draft(uuid,text), public.discard_gallery_draft(uuid) to authenticated;
