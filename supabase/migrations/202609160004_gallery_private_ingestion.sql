create type public.gallery_target as enum ('GALLERY','ARTIST_PORTFOLIO');
create type public.gallery_asset_status as enum ('DRAFT');
create type public.gallery_variant_kind as enum ('MASTER','DISPLAY','THUMB');

alter table public.artist_profile add constraint artist_profile_studio_id_unique unique (studio_id,id);

create table public.gallery_asset (
  id uuid primary key,
  public_id uuid not null unique default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  target public.gallery_target not null,
  artist_profile_id uuid,
  alt_text text not null check (char_length(alt_text) between 1 and 160 and alt_text = btrim(alt_text)),
  position integer not null check (position > 0),
  status public.gallery_asset_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_asset_target_artist_check check ((target='GALLERY' and artist_profile_id is null) or (target='ARTIST_PORTFOLIO' and artist_profile_id is not null)),
  constraint gallery_asset_artist_same_studio_fk foreign key (studio_id,artist_profile_id) references public.artist_profile(studio_id,id) on delete restrict,
  constraint gallery_asset_position_unique unique nulls not distinct (studio_id,target,artist_profile_id,position),
  constraint gallery_asset_studio_id_unique unique (studio_id,id)
);

create table public.gallery_variant (
  asset_id uuid not null,
  studio_id uuid not null,
  kind public.gallery_variant_kind not null,
  object_path text not null unique check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(master|display|thumb)\.webp$' and object_path not like '%..%'),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  mime_type text not null check (mime_type='image/webp'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  created_at timestamptz not null default now(),
  primary key (asset_id,kind),
  constraint gallery_variant_asset_same_studio_fk foreign key (studio_id,asset_id) references public.gallery_asset(studio_id,id) on delete cascade
);

alter table public.gallery_asset enable row level security;
alter table public.gallery_variant enable row level security;
revoke all on table public.gallery_asset, public.gallery_variant from public, anon, authenticated, service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gallery-private','gallery-private',false,10485760,array['image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.assert_authenticated_owner(p_studio_id uuid)
returns void language plpgsql stable security definer set search_path=''
as $$
declare v_user_id uuid := (select auth.uid()); v_count integer;
begin
  if v_user_id is null or p_studio_id is null then raise insufficient_privilege using message='gallery unavailable'; end if;
  select count(*)::integer into v_count from public.membership m
  join public.user_profile p on p.id=m.user_profile_id and p.studio_id=m.studio_id and p.user_id=m.user_id
  where m.user_id=v_user_id and m.studio_id=p_studio_id and m.role='OWNER';
  if v_count <> 1 or (select count(*) from public.membership where user_id=v_user_id) <> 1 then raise insufficient_privilege using message='gallery unavailable'; end if;
end; $$;
revoke all on function private.assert_authenticated_owner(uuid) from public, anon, authenticated, service_role;

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
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text||':'||p_target||':'||coalesce(p_artist_profile_id::text,''),0));
  select coalesce(max(position),0)+1 into v_position from public.gallery_asset where studio_id=p_studio_id and target=v_target and artist_profile_id is not distinct from p_artist_profile_id;
  insert into public.gallery_asset(id,studio_id,target,artist_profile_id,alt_text,position) values(p_asset_id,p_studio_id,v_target,p_artist_profile_id,p_alt_text,v_position);
  for v_variant in select value from jsonb_array_elements(p_variants) loop
    if (select count(*) from jsonb_object_keys(v_variant))<>6 or (v_variant->>'path')<>p_studio_id::text||'/'||p_asset_id::text||'/'||lower(v_variant->>'kind')||'.webp' then raise invalid_parameter_value using message='gallery draft invalid'; end if;
    insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values(p_asset_id,p_studio_id,(v_variant->>'kind')::public.gallery_variant_kind,v_variant->>'path',(v_variant->>'width')::integer,(v_variant->>'height')::integer,v_variant->>'mime_type',(v_variant->>'byte_size')::integer);
  end loop;
  return p_asset_id;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise invalid_parameter_value using message='gallery draft invalid';
end; $$;

create or replace function public.list_gallery_drafts(p_studio_id uuid,p_limit integer default 100)
returns table(public_id uuid,target text,artist_display_name text,alt_text text,"position" integer,width integer,height integer,thumb_path text)
language plpgsql stable security definer set search_path=''
as $$ begin
  perform private.assert_authenticated_owner(p_studio_id);
  if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value using message='gallery draft invalid'; end if;
  return query select a.public_id,a.target::text,artist.display_name,a.alt_text,a.position,v.width,v.height,v.object_path
  from public.gallery_asset a join public.gallery_variant v on v.asset_id=a.id and v.studio_id=a.studio_id and v.kind='THUMB'
  left join public.artist_profile artist on artist.id=a.artist_profile_id and artist.studio_id=a.studio_id
  where a.studio_id=p_studio_id and a.status='DRAFT'
  order by a.target,artist.display_name nulls first,a.position,a.created_at,a.id limit p_limit;
end; $$;

revoke all on function public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb), public.list_gallery_drafts(uuid,integer) from public, anon, service_role;
grant execute on function public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb), public.list_gallery_drafts(uuid,integer) to authenticated;
