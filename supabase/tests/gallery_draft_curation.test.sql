begin;
select plan(54);

select is((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.gallery_asset_status'::regtype),'DRAFT,DISCARDED','gallery status supports recoverable discard');
select has_function('public','update_gallery_draft',array['uuid','text','text','uuid'],'draft update RPC exists');
select has_function('public','move_gallery_draft',array['uuid','text'],'draft move RPC exists');
select has_function('public','discard_gallery_draft',array['uuid'],'draft discard RPC exists');
select is((select proconfig from pg_proc where oid='public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure),array['search_path=""'],'update fixes empty search path');
select is((select proconfig from pg_proc where oid='public.move_gallery_draft(uuid,text)'::regprocedure),array['search_path=""'],'move fixes empty search path');
select is((select proconfig from pg_proc where oid='public.discard_gallery_draft(uuid)'::regprocedure),array['search_path=""'],'discard fixes empty search path');
select ok(has_function_privilege('authenticated','public.update_gallery_draft(uuid,text,text,uuid)','execute'),'authenticated may call auth-bound update');
select ok(has_function_privilege('authenticated','public.move_gallery_draft(uuid,text)','execute'),'authenticated may call auth-bound move');
select ok(has_function_privilege('authenticated','public.discard_gallery_draft(uuid)','execute'),'authenticated may call auth-bound discard');
select ok(not has_function_privilege('anon','public.update_gallery_draft(uuid,text,text,uuid)','execute'),'anonymous cannot update');
select ok(not has_function_privilege('anon','public.move_gallery_draft(uuid,text)','execute'),'anonymous cannot move');
select ok(not has_function_privilege('anon','public.discard_gallery_draft(uuid)','execute'),'anonymous cannot discard');
select ok(not has_function_privilege('service_role','public.update_gallery_draft(uuid,text,text,uuid)','execute'),'service role cannot update metadata');
select ok(not has_function_privilege('service_role','public.move_gallery_draft(uuid,text)','execute'),'service role cannot move metadata');
select ok(not has_function_privilege('service_role','public.discard_gallery_draft(uuid)','execute'),'service role cannot discard metadata');
select ok(not has_table_privilege('authenticated','public.gallery_asset','update'),'authenticated has no direct asset update');
select ok(not has_table_privilege('authenticated','public.gallery_asset','delete'),'authenticated has no direct asset delete');
select ok(not has_table_privilege('service_role','public.gallery_asset','update'),'service role has no direct asset update');

set local role anon;
select throws_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000999')$$,'42501',null,'anonymous mutation invocation fails closed');
reset role; set local role service_role;
select throws_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000999')$$,'42501',null,'service role mutation invocation fails closed');
reset role;

insert into public.user_profile(id,studio_id,user_id,display_name) values
('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','South Artist');
insert into public.membership(id,studio_id,user_id,user_profile_id,role) values
('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','ARTIST');
insert into public.artist_profile(id,studio_id,membership_id,user_id,display_name) values
('50000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','South Artist Portfolio');

insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status) values
('61000000-0000-4000-8000-000000000101','90000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','GALLERY',null,'North A',1,'DRAFT'),
('61000000-0000-4000-8000-000000000102','90000000-0000-4000-8000-000000000102','20000000-0000-0000-0000-000000000001','GALLERY',null,'North B',2,'DRAFT'),
('61000000-0000-4000-8000-000000000103','90000000-0000-4000-8000-000000000103','20000000-0000-0000-0000-000000000001','GALLERY',null,'North C',3,'DRAFT'),
('61000000-0000-4000-8000-000000000104','90000000-0000-4000-8000-000000000104','20000000-0000-0000-0000-000000000001','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000001','North portfolio',1,'DRAFT'),
('61000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','GALLERY',null,'South A',1,'DRAFT');
insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values
('61000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/61000000-0000-4000-8000-000000000101/thumb.webp',10,10,'image/webp',101),
('61000000-0000-4000-8000-000000000102','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/61000000-0000-4000-8000-000000000102/thumb.webp',10,10,'image/webp',102),
('61000000-0000-4000-8000-000000000103','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/61000000-0000-4000-8000-000000000103/thumb.webp',10,10,'image/webp',103),
('61000000-0000-4000-8000-000000000104','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/61000000-0000-4000-8000-000000000104/thumb.webp',10,10,'image/webp',104),
('61000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','THUMB','20000000-0000-0000-0000-000000000002/61000000-0000-4000-8000-000000000201/thumb.webp',10,10,'image/webp',201);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000101','North A edited','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000001')$$,'owner edits and reassigns a draft');
reset role;
select is((select target::text||':'||artist_profile_id::text||':'||position::text||':'||alt_text from public.gallery_asset where public_id='90000000-0000-4000-8000-000000000101'),'ARTIST_PORTFOLIO:50000000-0000-0000-0000-000000000001:2:North A edited','reassignment appends to the new group');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000101','Cross artist','ARTIST_PORTFOLIO','50000000-0000-4000-8000-000000000002')$$,'22023','gallery draft invalid','cross-tenant artist fails atomically');
reset role;
select is((select alt_text from public.gallery_asset where public_id='90000000-0000-4000-8000-000000000101'),'North A edited','failed cross-tenant edit changes nothing');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000201','Foreign','GALLERY',null)$$,'42501',null,'cross-tenant asset update fails closed');
reset role;
select is((select alt_text from public.gallery_asset where public_id='90000000-0000-4000-8000-000000000201'),'South A','cross-tenant asset remains unchanged');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000101','Invalid','PUBLIC',null)$$,'22023','gallery draft invalid','invalid target fails closed');
select lives_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000101','MOVE_UP')$$,'owner moves up with immediate-neighbor swap');
reset role;
select is((select string_agg(public_id::text,',' order by position) from public.gallery_asset where studio_id='20000000-0000-0000-0000-000000000001' and target='ARTIST_PORTFOLIO' and status='DRAFT'),'90000000-0000-4000-8000-000000000101,90000000-0000-4000-8000-000000000104','move up swaps only the immediate draft neighbor');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000101','MOVE_UP')$$,'move up at first edge is an idempotent success');
reset role;
select is((select position from public.gallery_asset where public_id='90000000-0000-4000-8000-000000000101'),1,'edge move preserves position');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000101','MOVE_DOWN')$$,'owner moves down with immediate-neighbor swap');
reset role;
select is((select string_agg(public_id::text,',' order by position) from public.gallery_asset where studio_id='20000000-0000-0000-0000-000000000001' and target='ARTIST_PORTFOLIO' and status='DRAFT'),'90000000-0000-4000-8000-000000000104,90000000-0000-4000-8000-000000000101','move down restores portfolio order');
select is((select string_agg(public_id::text||':'||position::text,',' order by position) from public.gallery_asset where studio_id='20000000-0000-0000-0000-000000000001' and target='GALLERY' and status='DRAFT'),'90000000-0000-4000-8000-000000000102:2,90000000-0000-4000-8000-000000000103:3','reorder does not compact or alter another group');
select is((select position from public.gallery_asset where public_id='90000000-0000-4000-8000-000000000201'),1,'reorder does not affect another tenant');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000102')$$,'owner discards a draft');
select lives_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000102')$$,'discard is idempotent');
reset role;
select is((select status::text||':'||position::text||':'||(select count(*) from public.gallery_variant v where v.asset_id=a.id)::text from public.gallery_asset a where public_id='90000000-0000-4000-8000-000000000102'),'DISCARDED:2:1','discard preserves row position and variant metadata');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100) where thumbnail_handle='90000000-0000-4000-8000-000000000102'),0::bigint,'discarded draft is absent from listing');
select throws_ok($$select * from public.resolve_gallery_thumbnail('90000000-0000-4000-8000-000000000102')$$,'42501','thumbnail unavailable','discarded draft thumbnail no longer resolves');
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000102','No edit','GALLERY',null)$$,'42501','gallery draft unavailable','discarded draft is not editable');
select throws_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000102','MOVE_DOWN')$$,'42501','gallery draft unavailable','discarded draft is not reorderable');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000101','MOVE_UP')$$,'42501',null,'cross-tenant owner cannot move');
select throws_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000101')$$,'42501',null,'cross-tenant owner cannot discard');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000101','Artist write','GALLERY',null)$$,'42501',null,'artist cannot update');
select throws_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000101','MOVE_UP')$$,'42501',null,'artist cannot move');
select throws_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000101')$$,'42501',null,'artist cannot discard');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.update_gallery_draft('90000000-0000-4000-8000-000000000999','Unknown','GALLERY',null)$$,'42501','gallery draft unavailable','unknown handle cannot update');
select throws_ok($$select public.move_gallery_draft('90000000-0000-4000-8000-000000000999','MOVE_UP')$$,'42501','gallery draft unavailable','unknown handle cannot move');
select throws_ok($$select public.discard_gallery_draft('90000000-0000-4000-8000-000000000999')$$,'42501','gallery draft unavailable','unknown handle cannot discard');
reset role;
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure))>0,'reassignment serializes group mutations in SQL');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure))>0 and position('set constraints public.gallery_asset_position_unique deferred' in lower(pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure)))>0,'move serializes the group and defers the atomic swap constraint');
select ok((pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure)||pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure)||pg_get_functiondef('public.discard_gallery_draft(uuid)'::regprocedure)) !~* '(delete[[:space:]]+from|storage\.)','curation RPCs contain no hard delete or Storage access');

select * from finish();
rollback;
