alter type public.gallery_asset_status add value 'DISCARDED';

alter table public.gallery_asset
  drop constraint gallery_asset_position_unique;

alter table public.gallery_asset
  add constraint gallery_asset_position_unique
  unique nulls not distinct (studio_id,target,artist_profile_id,position)
  deferrable initially immediate;
