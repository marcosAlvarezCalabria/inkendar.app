alter type public.gallery_asset_status add value 'PUBLISHING';
alter type public.gallery_asset_status add value 'PUBLISHED';
alter type public.gallery_asset_status add value 'RETIRING';
alter type public.gallery_asset_status add value 'RETIRED';

alter table public.gallery_asset
  add column published_at timestamptz,
  add column retired_at timestamptz;

create table public.gallery_publication_binding (
  asset_id uuid primary key,
  studio_id uuid not null,
  publication_key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint gallery_publication_binding_asset_same_studio_fk
    foreign key (studio_id,asset_id) references public.gallery_asset(studio_id,id) on delete restrict
);

alter table public.gallery_publication_binding enable row level security;
revoke all on table public.gallery_publication_binding from public, anon, authenticated, service_role;

create or replace function private.prevent_gallery_publication_binding_change()
returns trigger language plpgsql volatile security definer set search_path=''
as $$ begin
  raise object_not_in_prerequisite_state using message='gallery publication binding immutable';
end; $$;
revoke all on function private.prevent_gallery_publication_binding_change() from public, anon, authenticated, service_role;

create trigger gallery_publication_binding_immutable
before update on public.gallery_publication_binding
for each row execute function private.prevent_gallery_publication_binding_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gallery-public','gallery-public',true,10485760,array['image/webp'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
