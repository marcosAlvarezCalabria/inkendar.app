begin;
select plan(11);
select has_function('public','resolve_gallery_thumbnail',array['uuid'],'thumbnail resolver exists');
select is((select proconfig from pg_proc where oid='public.resolve_gallery_thumbnail(uuid)'::regprocedure),array['search_path=""'],'resolver fixes empty search path');
select ok(has_function_privilege('authenticated','public.resolve_gallery_thumbnail(uuid)','execute'),'authenticated may resolve an authorized opaque handle');
select ok(not has_function_privilege('service_role','public.resolve_gallery_thumbnail(uuid)','execute'),'service role cannot resolve metadata');
select ok(not has_function_privilege('anon','public.resolve_gallery_thumbnail(uuid)','execute'),'anonymous cannot resolve metadata');

insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status) values
('60000000-0000-4000-8000-000000000050','90000000-0000-4000-8000-000000000050','20000000-0000-0000-0000-000000000001','GALLERY',null,'Proxy fixture',1,'DRAFT'),
('60000000-0000-4000-8000-000000000051','90000000-0000-4000-8000-000000000051','20000000-0000-0000-0000-000000000002','GALLERY',null,'Foreign proxy fixture',1,'DRAFT');
insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values
('60000000-0000-4000-8000-000000000050','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000050/thumb.webp',10,10,'image/webp',123),
('60000000-0000-4000-8000-000000000051','20000000-0000-0000-0000-000000000002','THUMB','20000000-0000-0000-0000-000000000002/60000000-0000-4000-8000-000000000051/thumb.webp',10,10,'image/webp',124);

set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select object_path from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000050')),'20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000050/thumb.webp','owner resolves own opaque handle');
select is((select byte_size from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000050')),123,'resolver returns bounded persisted size');
select throws_ok($$select * from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000051')$$,'42501',null,'cross-tenant owner fails closed');
select throws_ok($$select * from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000099')$$,'42501','thumbnail unavailable','unknown handle is generic');

reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select * from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000050')$$,'42501',null,'artist cannot resolve thumbnail');

reset role; set local role service_role;
select throws_ok($$select * from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000050')$$,'42501',null,'service role misuse fails closed');
select * from finish(); rollback;
