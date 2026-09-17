begin;
select plan(30);

select has_column('public','studio','public_slug','studio has a public slug');
select has_column('public','artist_profile','public_slug','artist has a public slug');
select col_not_null('public','studio','public_slug','studio public slug is required');
select col_not_null('public','artist_profile','public_slug','artist public slug is required');
select has_function('public','get_public_studio_gallery',array['uuid','integer'],'public gallery resolver exists');
select is((select provolatile from pg_proc where oid='public.get_public_studio_gallery(uuid,integer)'::regprocedure),'s','public resolver is read-only stable');
select is((select proconfig from pg_proc where oid='public.get_public_studio_gallery(uuid,integer)'::regprocedure),array['search_path=""'],'public resolver fixes empty search path');
select ok(has_function_privilege('service_role','public.get_public_studio_gallery(uuid,integer)','execute'),'server role can resolve a feed');
select ok(not has_function_privilege('anon','public.get_public_studio_gallery(uuid,integer)','execute'),'anonymous browser cannot invoke the database resolver');
select ok(not has_function_privilege('authenticated','public.get_public_studio_gallery(uuid,integer)','execute'),'authenticated browser cannot invoke the database resolver');
select ok(not has_table_privilege('anon','public.gallery_asset','select'),'anonymous cannot read gallery assets directly');
select ok(not has_table_privilege('anon','public.gallery_publication_binding','select'),'anonymous cannot read publication bindings');

create temporary table feed_slugs as
select
  (select public_slug from public.studio where id='20000000-0000-0000-0000-000000000001') studio_one,
  (select public_slug from public.studio where id='20000000-0000-0000-0000-000000000002') studio_two,
  (select public_slug from public.artist_profile where id='50000000-0000-0000-0000-000000000001') artist_one;
grant select on feed_slugs to service_role, anon, authenticated;

insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status,published_at,updated_at) values
('63000000-0000-4000-8000-000000000101','93000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','GALLERY',null,'Published gallery',101,'PUBLISHED','2026-09-17T09:00:00Z','2026-09-17T09:00:00Z'),
('63000000-0000-4000-8000-000000000102','93000000-0000-4000-8000-000000000102','20000000-0000-0000-0000-000000000001','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000001','Published portfolio',102,'PUBLISHED','2026-09-17T09:01:00Z','2026-09-17T09:01:00Z'),
('63000000-0000-4000-8000-000000000103','93000000-0000-4000-8000-000000000103','20000000-0000-0000-0000-000000000001','GALLERY',null,'Publishing hidden',103,'PUBLISHING',null,'2026-09-17T09:02:00Z'),
('63000000-0000-4000-8000-000000000104','93000000-0000-4000-8000-000000000104','20000000-0000-0000-0000-000000000001','GALLERY',null,'Retiring hidden',104,'RETIRING','2026-09-17T09:03:00Z','2026-09-17T09:04:00Z'),
('63000000-0000-4000-8000-000000000201','93000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','GALLERY',null,'Other tenant',101,'PUBLISHED','2026-09-17T09:05:00Z','2026-09-17T09:05:00Z');

insert into public.gallery_publication_binding(asset_id,studio_id,publication_key) values
('63000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','73000000-0000-4000-8000-000000000101'),
('63000000-0000-4000-8000-000000000102','20000000-0000-0000-0000-000000000001','73000000-0000-4000-8000-000000000102'),
('63000000-0000-4000-8000-000000000103','20000000-0000-0000-0000-000000000001','73000000-0000-4000-8000-000000000103'),
('63000000-0000-4000-8000-000000000104','20000000-0000-0000-0000-000000000001','73000000-0000-4000-8000-000000000104'),
('63000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','73000000-0000-4000-8000-000000000201');

insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size)
select asset.id,asset.studio_id,kind.kind,
  asset.studio_id::text||'/'||asset.id::text||'/'||lower(kind.kind::text)||'.webp',
  case when kind.kind='DISPLAY' then 1200 else 480 end,
  case when kind.kind='DISPLAY' then 800 else 320 end,
  'image/webp',100
from public.gallery_asset asset cross join (values ('DISPLAY'::public.gallery_variant_kind),('THUMB'::public.gallery_variant_kind)) kind(kind)
where asset.id::text like '63000000-0000-4000-8000-000000000%';

set local role service_role;
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)->>'studio_public_slug',(select studio_one::text from feed_slugs),'feed resolves the stable public studio slug');
select is(jsonb_array_length(public.get_public_studio_gallery((select studio_one from feed_slugs),100)->'gallery_images'),1,'only one PUBLISHED gallery image is returned');
select is(jsonb_array_length(public.get_public_studio_gallery((select studio_one from feed_slugs),100)->'artists'),1,'published portfolios are grouped by artist');
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)#>>'{artists,0,artist_public_slug}',(select artist_one::text from feed_slugs),'artist uses its separate public slug');
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)#>>'{gallery_images,0,public_id}','93000000-0000-4000-8000-000000000101','asset uses its public id');
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)#>>'{gallery_images,0,image_variants,display,path}','73000000-0000-4000-8000-000000000101/display.webp','display path is immutable and versioned by the binding');
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)#>>'{gallery_images,0,image_variants,thumb,mime_type}','image/webp','only public WebP variants are described');
select ok(not (public.get_public_studio_gallery((select studio_one from feed_slugs),100)::text ilike any(array['%master.webp%','%gallery-private%','%studio_id%','%asset_id%','%user_id%','%publication_key%','%customer%','%conversation%','%calendar%']))),'feed excludes masters, private paths, bindings and internal/private fields');
select ok(public.get_public_studio_gallery((select studio_one from feed_slugs),100)::text not like '%Other tenant%','feed cannot cross tenant boundaries');
select is(public.get_public_studio_gallery((select studio_two from feed_slugs),100)#>>'{gallery_images,0,alt_text}','Other tenant','another public slug resolves only its own tenant');
select is(public.get_public_studio_gallery('a0000000-0000-4000-8000-000000000099',100),null::jsonb,'unknown slug is uniform null');
select throws_ok($$select public.get_public_studio_gallery((select studio_one from feed_slugs),101)$$,'22023','public gallery invalid','limit is capped at 100');
reset role;

select throws_ok($$update public.studio set public_slug='a0000000-0000-4000-8000-000000000099' where id='20000000-0000-0000-0000-000000000001'$$,'55000','public slug immutable','studio public slug cannot change');
select throws_ok($$update public.artist_profile set public_slug='b0000000-0000-4000-8000-000000000099' where id='50000000-0000-0000-0000-000000000001'$$,'55000','public slug immutable','artist public slug cannot change');

update public.gallery_asset set status='RETIRING',updated_at='2026-09-17T10:00:00Z' where id='63000000-0000-4000-8000-000000000101';
set local role service_role;
select is(jsonb_array_length(public.get_public_studio_gallery((select studio_one from feed_slugs),100)->'gallery_images'),0,'RETIRING is excluded immediately at origin');
select is(public.get_public_studio_gallery((select studio_one from feed_slugs),100)->>'updated_at','2026-09-17T10:00:00+00:00','public lifecycle revision advances on retirement');
reset role; set local role anon;
select throws_ok(format('select public.get_public_studio_gallery(%L,100)',(select studio_one from feed_slugs)),'42501',null,'anonymous invocation fails closed');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok(format('select public.get_public_studio_gallery(%L,100)',(select studio_one from feed_slugs)),'42501',null,'authenticated browser invocation fails closed');

select * from finish();
rollback;
