alter table public.studio
  add column public_slug uuid not null default gen_random_uuid(),
  add constraint studio_public_slug_unique unique (public_slug);

alter table public.artist_profile
  add column public_slug uuid not null default gen_random_uuid(),
  add constraint artist_profile_public_slug_unique unique (public_slug);

create or replace function private.prevent_public_slug_change()
returns trigger language plpgsql volatile security definer set search_path=''
as $$
begin
  if new.public_slug is distinct from old.public_slug then
    raise object_not_in_prerequisite_state using message='public slug immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_public_slug_change() from public, anon, authenticated, service_role;

create trigger studio_public_slug_immutable
before update of public_slug on public.studio
for each row execute function private.prevent_public_slug_change();

create trigger artist_profile_public_slug_immutable
before update of public_slug on public.artist_profile
for each row execute function private.prevent_public_slug_change();

create or replace function public.get_public_studio_gallery(p_studio_slug uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_studio_id uuid;
  v_studio_updated_at timestamptz;
  v_feed_updated_at timestamptz;
  v_result jsonb;
begin
  if p_studio_slug is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise invalid_parameter_value using message='public gallery invalid';
  end if;

  select studio.id,studio.updated_at into v_studio_id,v_studio_updated_at
  from public.studio studio where studio.public_slug=p_studio_slug;
  if not found then return null; end if;

  select coalesce(max(asset.updated_at),v_studio_updated_at) into v_feed_updated_at
  from public.gallery_asset asset
  where asset.studio_id=v_studio_id and asset.status in ('PUBLISHED','RETIRING','RETIRED');

  with eligible as materialized (
    select asset.public_id,asset.target,asset.position,asset.published_at,
      artist.public_slug as artist_public_slug,artist.display_name as artist_display_name,
      jsonb_build_object(
        'public_id',asset.public_id,
        'image_variants',jsonb_build_object(
          'display',jsonb_build_object('path',binding.publication_key::text||'/display.webp','width',display.width,'height',display.height,'mime_type',display.mime_type),
          'thumb',jsonb_build_object('path',binding.publication_key::text||'/thumb.webp','width',thumb.width,'height',thumb.height,'mime_type',thumb.mime_type)
        ),
        'alt_text',asset.alt_text,
        'position',asset.position,
        'published_at',asset.published_at
      ) as image
    from public.gallery_asset asset
    join public.gallery_publication_binding binding on binding.asset_id=asset.id and binding.studio_id=asset.studio_id
    join public.gallery_variant display on display.asset_id=asset.id and display.studio_id=asset.studio_id and display.kind='DISPLAY' and display.mime_type='image/webp'
    join public.gallery_variant thumb on thumb.asset_id=asset.id and thumb.studio_id=asset.studio_id and thumb.kind='THUMB' and thumb.mime_type='image/webp'
    left join public.artist_profile artist on artist.id=asset.artist_profile_id and artist.studio_id=asset.studio_id
    where asset.studio_id=v_studio_id and asset.status='PUBLISHED' and asset.published_at is not null
      and ((asset.target='GALLERY' and asset.artist_profile_id is null)
        or (asset.target='ARTIST_PORTFOLIO' and asset.artist_profile_id is not null and artist.id is not null))
    order by case when asset.target='GALLERY' then 0 else 1 end,
      artist.display_name nulls first,artist.public_slug,asset.position,asset.published_at,asset.public_id
    limit p_limit
  ), artist_groups as (
    select item.artist_public_slug,item.artist_display_name,
      jsonb_agg(item.image order by item.position,item.published_at,item.public_id) as portfolio_images
    from eligible item where item.target='ARTIST_PORTFOLIO'
    group by item.artist_public_slug,item.artist_display_name
  )
  select jsonb_build_object(
    'studio_public_slug',p_studio_slug,
    'updated_at',v_feed_updated_at,
    'gallery_images',coalesce((
      select jsonb_agg(item.image order by item.position,item.published_at,item.public_id)
      from eligible item where item.target='GALLERY'
    ),'[]'::jsonb),
    'artists',coalesce((
      select jsonb_agg(jsonb_build_object(
        'artist_public_slug',grouped.artist_public_slug,
        'display_name',grouped.artist_display_name,
        'portfolio_images',grouped.portfolio_images
      ) order by grouped.artist_display_name,grouped.artist_public_slug)
      from artist_groups grouped
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_public_studio_gallery(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_public_studio_gallery(uuid,integer) to service_role;
