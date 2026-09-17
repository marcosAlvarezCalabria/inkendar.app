begin;
select plan(49);

select has_function('public','list_gallery_discarded_assets',array['uuid','integer'],'discarded list RPC exists');
select has_function('public','restore_gallery_draft',array['uuid'],'restore RPC exists');
select is((select proconfig from pg_proc where oid='public.list_gallery_discarded_assets(uuid,integer)'::regprocedure),array['search_path=""'],'discarded list fixes empty search path');
select is((select proconfig from pg_proc where oid='public.restore_gallery_draft(uuid)'::regprocedure),array['search_path=""'],'restore fixes empty search path');
select ok(has_function_privilege('authenticated','public.list_gallery_discarded_assets(uuid,integer)','execute'),'authenticated may call auth-bound discarded list');
select ok(has_function_privilege('authenticated','public.restore_gallery_draft(uuid)','execute'),'authenticated may call auth-bound restore');
select ok(not has_function_privilege('anon','public.list_gallery_discarded_assets(uuid,integer)','execute'),'anon cannot list discarded assets');
select ok(not has_function_privilege('anon','public.restore_gallery_draft(uuid)','execute'),'anon cannot restore');
select ok(not has_function_privilege('service_role','public.list_gallery_discarded_assets(uuid,integer)','execute'),'service role cannot list discarded metadata');
select ok(not has_function_privilege('service_role','public.restore_gallery_draft(uuid)','execute'),'service role cannot restore metadata');
select ok(not has_table_privilege('authenticated','public.gallery_asset','update'),'authenticated still has no direct asset update');
select ok(not has_table_privilege('authenticated','public.gallery_asset','delete'),'authenticated still has no hard delete');

set local role anon;
select throws_ok($$select * from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100)$$,'42501',null,'anonymous discarded list invocation fails closed');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'42501',null,'anonymous restore invocation fails closed');
reset role; set local role service_role;
select throws_ok($$select * from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100)$$,'42501',null,'service role discarded list invocation fails closed');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'42501',null,'service role restore invocation fails closed');
reset role;

insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status,created_at,updated_at,published_at,retired_at) values
('63000000-0000-4000-8000-000000000101','93000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','GALLERY',null,'Recover me',2,'DISCARDED','2026-09-16T09:00:00Z','2026-09-17T10:00:00Z',null,null),
('63000000-0000-4000-8000-000000000102','93000000-0000-4000-8000-000000000102','20000000-0000-0000-0000-000000000001','GALLERY',null,'Older discard',4,'DISCARDED','2026-09-16T08:00:00Z','2026-09-17T09:00:00Z',null,null),
('63000000-0000-4000-8000-000000000103','93000000-0000-4000-8000-000000000103','20000000-0000-0000-0000-000000000001','GALLERY',null,'Active end',7,'DRAFT','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z',null,null),
('63000000-0000-4000-8000-000000000104','93000000-0000-4000-8000-000000000104','20000000-0000-0000-0000-000000000001','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000001','Other group',20,'DRAFT','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z',null,null),
('63000000-0000-4000-8000-000000000105','93000000-0000-4000-8000-000000000105','20000000-0000-0000-0000-000000000001','GALLERY',null,'Publishing',11,'PUBLISHING','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z',null,null),
('63000000-0000-4000-8000-000000000106','93000000-0000-4000-8000-000000000106','20000000-0000-0000-0000-000000000001','GALLERY',null,'Published',12,'PUBLISHED','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z',null),
('63000000-0000-4000-8000-000000000107','93000000-0000-4000-8000-000000000107','20000000-0000-0000-0000-000000000001','GALLERY',null,'Retiring',13,'RETIRING','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z',null),
('63000000-0000-4000-8000-000000000108','93000000-0000-4000-8000-000000000108','20000000-0000-0000-0000-000000000001','GALLERY',null,'Retired',14,'RETIRED','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z','2026-09-16T10:00:00Z','2026-09-16T11:00:00Z'),
('63000000-0000-4000-8000-000000000201','93000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','GALLERY',null,'Foreign discard',50,'DISCARDED','2026-09-16T10:00:00Z','2026-09-17T11:00:00Z',null,null);

insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values
('63000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','MASTER','20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/master.webp',1200,800,'image/webp',101),
('63000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','DISPLAY','20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/display.webp',1200,800,'image/webp',102),
('63000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/thumb.webp',480,320,'image/webp',103),
('63000000-0000-4000-8000-000000000106','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000106/thumb.webp',480,320,'image/webp',106);
insert into public.gallery_publication_binding(asset_id,studio_id,publication_key) values
('63000000-0000-4000-8000-000000000106','20000000-0000-0000-0000-000000000001','73000000-0000-4000-8000-000000000106');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select string_agg(handle::text,',' order by ordinality) from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100) with ordinality),'93000000-0000-4000-8000-000000000101,93000000-0000-4000-8000-000000000102','discarded list is tenant-scoped and deterministic');
select is((select count(*) from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',1)),1::bigint,'discarded list respects caller limit');
select throws_ok($$select * from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',101)$$,'22023','gallery restore invalid','discarded list rejects a limit over 100');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select * from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100)$$,'42501',null,'cross-tenant owner cannot list discarded assets');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select * from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100)$$,'42501',null,'ARTIST cannot list discarded assets');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'owner restores a discarded asset');
reset role;
select is((select status::text||':'||position::text from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),'DRAFT:2','restore preserves the position reserved by the discarded row');
select is((select target::text||':'||coalesce(artist_profile_id::text,'none')||':'||alt_text from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),'GALLERY:none:Recover me','restore preserves target, artist and alt');
select is((select string_agg(kind::text||':'||object_path||':'||byte_size::text,',' order by kind) from public.gallery_variant where asset_id='63000000-0000-4000-8000-000000000101'),'MASTER:20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/master.webp:101,DISPLAY:20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/display.webp:102,THUMB:20000000-0000-0000-0000-000000000001/63000000-0000-4000-8000-000000000101/thumb.webp:103','restore preserves all private variant metadata');
select is((select position from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000104'),20,'restore does not alter another group');
select is((select position from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000201'),50,'restore does not alter another tenant');
create temporary table restored_snapshot as select position,updated_at from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101';
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'DRAFT retry converges as success');
reset role;
select is((select position from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),(select position from restored_snapshot),'DRAFT retry does not move the asset again');
select is((select updated_at from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),(select updated_at from restored_snapshot),'DRAFT retry is a metadata no-op');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.discard_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'owner discards the restored asset again');
select lives_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'owner restores the asset for a second cycle');
reset role;
select is((select position from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),2,'second discard and restore cycle preserves the original position');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.discard_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'owner discards the restored asset a third time');
select lives_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000101')$$,'owner restores the asset for a third cycle');
reset role;
select is((select position from public.gallery_asset where public_id='93000000-0000-4000-8000-000000000101'),2,'third discard and restore cycle preserves the original position');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000102')$$,'42501',null,'cross-tenant owner cannot restore');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000102')$$,'42501',null,'ARTIST cannot restore');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000999')$$,'42501','gallery restore unavailable','unknown handle fails closed');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000105')$$,'42501','gallery restore unavailable','PUBLISHING cannot restore');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000106')$$,'42501','gallery restore unavailable','PUBLISHED cannot restore');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000107')$$,'42501','gallery restore unavailable','RETIRING cannot restore');
select throws_ok($$select public.restore_gallery_draft('93000000-0000-4000-8000-000000000108')$$,'42501','gallery restore unavailable','RETIRED cannot restore');
reset role;
select is((select publication_key from public.gallery_publication_binding where asset_id='63000000-0000-4000-8000-000000000106'),'73000000-0000-4000-8000-000000000106'::uuid,'failed restore preserves publication binding');
select is((select string_agg(status::text,',' order by position) from public.gallery_asset where id in ('63000000-0000-4000-8000-000000000105','63000000-0000-4000-8000-000000000106','63000000-0000-4000-8000-000000000107','63000000-0000-4000-8000-000000000108')),'PUBLISHING,PUBLISHED,RETIRING,RETIRED','failed restores preserve publication lifecycle states');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))>0 and position('private.lock_gallery_studio' in pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))<position('for update' in lower(pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))),'restore acquires the common studio lock before row locks');
select ok((pg_get_functiondef('public.list_gallery_discarded_assets(uuid,integer)'::regprocedure)||pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure)) !~* '(delete[[:space:]]+from|storage\.)','restore RPCs contain no hard delete or Storage SQL');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.list_gallery_discarded_assets('20000000-0000-0000-0000-000000000001',100) where handle='93000000-0000-4000-8000-000000000101'),0::bigint,'restored asset leaves the discarded list');
select is((select byte_size from public.resolve_gallery_thumbnail('93000000-0000-4000-8000-000000000101')),103,'restored DRAFT regains the existing private thumbnail route');
reset role;

select * from finish();
rollback;
