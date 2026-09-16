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
  v_current_target public.gallery_target;
  v_current_artist_profile_id uuid;
  v_status public.gallery_asset_status;
  v_target public.gallery_target;
  v_position integer;
  v_lock_key bigint;
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

  loop
    select asset.target,asset.artist_profile_id,asset.status
      into strict v_old_target,v_old_artist_profile_id,v_status
    from public.gallery_asset asset where asset.id=v_asset_id and asset.studio_id=v_studio_id;
    if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;
    for v_lock_key in
      select distinct locks.lock_key from (values
        (hashtextextended(v_studio_id::text||':'||v_old_target::text||':'||coalesce(v_old_artist_profile_id::text,''),0)),
        (hashtextextended(v_studio_id::text||':'||v_target::text||':'||coalesce(p_artist_profile_id::text,''),0))
      ) locks(lock_key) order by locks.lock_key
    loop perform pg_advisory_xact_lock(v_lock_key); end loop;
    select asset.target,asset.artist_profile_id,asset.status
      into strict v_current_target,v_current_artist_profile_id,v_status
    from public.gallery_asset asset
    where asset.id=v_asset_id and asset.studio_id=v_studio_id
    for update;
    if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;
    exit when v_current_target=v_old_target and v_current_artist_profile_id is not distinct from v_old_artist_profile_id;
  end loop;

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
  v_current_target public.gallery_target;
  v_current_artist_profile_id uuid;
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

  loop
    select asset.target,asset.artist_profile_id,asset.status
      into strict v_target,v_artist_profile_id,v_status
    from public.gallery_asset asset where asset.id=v_asset_id and asset.studio_id=v_studio_id;
    if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_studio_id::text||':'||v_target::text||':'||coalesce(v_artist_profile_id::text,''),0));
    select asset.target,asset.artist_profile_id,asset.status,asset.position
      into strict v_current_target,v_current_artist_profile_id,v_status,v_position
    from public.gallery_asset asset
    where asset.id=v_asset_id and asset.studio_id=v_studio_id
    for update;
    if v_status<>'DRAFT' then raise insufficient_privilege using message='gallery draft unavailable'; end if;
    exit when v_current_target=v_target and v_current_artist_profile_id is not distinct from v_artist_profile_id;
  end loop;

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

drop function public.list_gallery_drafts_v2(uuid,integer);

create function public.list_gallery_drafts_v2(p_studio_id uuid,p_limit integer default 100)
returns table(thumbnail_handle uuid,target text,artist_profile_id uuid,artist_display_name text,alt_text text,"position" integer,width integer,height integer)
language plpgsql stable security definer set search_path=''
as $$ begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  return query select asset.public_id,asset.target::text,asset.artist_profile_id,artist.display_name,asset.alt_text,asset.position,variant.width,variant.height
  from public.gallery_asset asset
  join public.gallery_variant variant on variant.asset_id=asset.id and variant.studio_id=asset.studio_id and variant.kind='THUMB' and variant.mime_type='image/webp'
  left join public.artist_profile artist on artist.id=asset.artist_profile_id and artist.studio_id=asset.studio_id
  where asset.studio_id=p_studio_id and asset.status='DRAFT' and asset.target in ('GALLERY','ARTIST_PORTFOLIO')
  order by asset.target,artist.display_name nulls first,asset.position,asset.created_at,asset.id limit p_limit;
end; $$;

revoke all on function public.update_gallery_draft(uuid,text,text,uuid), public.move_gallery_draft(uuid,text), public.discard_gallery_draft(uuid), public.list_gallery_drafts_v2(uuid,integer) from public, anon, service_role;
grant execute on function public.update_gallery_draft(uuid,text,text,uuid), public.move_gallery_draft(uuid,text), public.discard_gallery_draft(uuid), public.list_gallery_drafts_v2(uuid,integer) to authenticated;
