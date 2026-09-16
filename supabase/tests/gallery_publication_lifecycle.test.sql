begin;
select plan(54);

select is((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.gallery_asset_status'::regtype),'DRAFT,DISCARDED,PUBLISHING,PUBLISHED,RETIRING,RETIRED','gallery lifecycle states are forward-compatible');
select has_table('public','gallery_publication_binding','immutable publication binding table exists');
select col_is_pk('public','gallery_publication_binding','asset_id','one binding per asset');
select has_column('public','gallery_asset','published_at','published_at exists');
select has_column('public','gallery_asset','retired_at','retired_at exists');
select has_function('public','begin_gallery_publish',array['uuid'],'begin publish exists');
select has_function('public','finalize_gallery_publish',array['uuid','uuid'],'finalize publish exists');
select has_function('public','begin_gallery_retire',array['uuid'],'begin retire exists');
select has_function('public','finalize_gallery_retire',array['uuid','uuid'],'finalize retire exists');
select has_function('public','list_gallery_assets_v3',array['uuid','integer'],'lifecycle list exists');
select is((select proconfig from pg_proc where oid='public.begin_gallery_publish(uuid)'::regprocedure),array['search_path=""'],'begin publish fixes empty search path');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.begin_gallery_publish(uuid)'::regprocedure))>0,'begin publish joins studio lock protocol');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.begin_gallery_retire(uuid)'::regprocedure))>0,'begin retire joins studio lock protocol');
select ok(has_function_privilege('authenticated','public.begin_gallery_publish(uuid)','execute'),'authenticated may call auth-bound begin publish');
select ok(not has_function_privilege('anon','public.begin_gallery_publish(uuid)','execute'),'anon cannot begin publish');
select ok(not has_function_privilege('service_role','public.begin_gallery_publish(uuid)','execute'),'service role cannot begin publish metadata');
select ok(not has_function_privilege('service_role','public.finalize_gallery_publish(uuid,uuid)','execute'),'service role cannot finalize publish metadata');
select ok(not has_function_privilege('service_role','public.begin_gallery_retire(uuid)','execute'),'service role cannot begin retire metadata');
select ok(not has_function_privilege('service_role','public.finalize_gallery_retire(uuid,uuid)','execute'),'service role cannot finalize retire metadata');
select ok(not has_table_privilege('authenticated','public.gallery_publication_binding','select'),'clients cannot read bindings');
select ok(not has_table_privilege('authenticated','public.gallery_publication_binding','update'),'clients cannot mutate bindings');
select is((select public::text||':'||file_size_limit::text||':'||array_to_string(allowed_mime_types,',') from storage.buckets where id='gallery-public'),'true:10485760:image/webp','public bucket is read-public and WebP bounded');
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and (qual ilike '%gallery-public%' or with_check ilike '%gallery-public%') and cmd in ('INSERT','UPDATE','DELETE')),0::bigint,'gallery-public has no client write/delete policy');

insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status) values
('62000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','GALLERY',null,'Publish me',90,'DRAFT'),
('62000000-0000-4000-8000-000000000201','92000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','GALLERY',null,'Foreign publish',90,'DRAFT');
insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values
('62000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','MASTER','20000000-0000-0000-0000-000000000001/62000000-0000-4000-8000-000000000101/master.webp',1200,800,'image/webp',7),
('62000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','DISPLAY','20000000-0000-0000-0000-000000000001/62000000-0000-4000-8000-000000000101/display.webp',1200,800,'image/webp',6),
('62000000-0000-4000-8000-000000000101','20000000-0000-0000-0000-000000000001','THUMB','20000000-0000-0000-0000-000000000001/62000000-0000-4000-8000-000000000101/thumb.webp',480,320,'image/webp',5),
('62000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','MASTER','20000000-0000-0000-0000-000000000002/62000000-0000-4000-8000-000000000201/master.webp',1200,800,'image/webp',7),
('62000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','DISPLAY','20000000-0000-0000-0000-000000000002/62000000-0000-4000-8000-000000000201/display.webp',1200,800,'image/webp',6),
('62000000-0000-4000-8000-000000000201','20000000-0000-0000-0000-000000000002','THUMB','20000000-0000-0000-0000-000000000002/62000000-0000-4000-8000-000000000201/thumb.webp',480,320,'image/webp',5);

set local role anon;
select throws_ok($$select * from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')$$,'42501',null,'anonymous publish invocation fails closed');
reset role; set local role service_role;
select throws_ok($$select * from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')$$,'42501',null,'service role publish invocation fails closed');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select * from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')$$,'42501',null,'ARTIST cannot publish');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select * from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')$$,'42501',null,'cross-tenant owner cannot publish');
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

create temporary table first_begin as select * from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101');
reset role;
select is((select outcome from first_begin),'WORK','DRAFT begins publication work');
select is((select status::text from public.gallery_asset where public_id='92000000-0000-4000-8000-000000000101'),'PUBLISHING','begin persists PUBLISHING before Storage');
select ok((select publication_key from first_begin) not in ('92000000-0000-4000-8000-000000000101'::uuid,'62000000-0000-4000-8000-000000000101'::uuid),'publication key is separate and opaque');
select is((select private_display_path from first_begin),'20000000-0000-0000-0000-000000000001/62000000-0000-4000-8000-000000000101/display.webp','begin returns private DISPLAY server binding');
select is((select private_thumb_path from first_begin),'20000000-0000-0000-0000-000000000001/62000000-0000-4000-8000-000000000101/thumb.webp','begin returns private THUMB server binding');
select is((select public_display_path from first_begin),(select publication_key::text||'/display.webp' from first_begin),'public display path is deterministic from key');
select is((select public_thumb_path from first_begin),(select publication_key::text||'/thumb.webp' from first_begin),'public thumb path is deterministic from key');
select ok((select row_to_json(first_begin)::text from first_begin) not like '%master.webp%','begin never returns MASTER');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select publication_key from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')),(select publication_key from first_begin),'PUBLISHING retry reuses the same binding');
select throws_ok(format('select public.finalize_gallery_publish(%L,%L)','92000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000099'),'42501','gallery publication unavailable','wrong binding cannot finalize');
reset role;
select is((select status::text from public.gallery_asset where public_id='92000000-0000-4000-8000-000000000101'),'PUBLISHING','failed finalize preserves PUBLISHING');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok(format('select public.finalize_gallery_publish(%L,%L)','92000000-0000-4000-8000-000000000101',(select publication_key from first_begin)),'matching binding finalizes publication');
reset role;
select is((select status::text||':'||(published_at is not null)::text||':'||(retired_at is null)::text from public.gallery_asset where public_id='92000000-0000-4000-8000-000000000101'),'PUBLISHED:true:true','finalize atomically timestamps PUBLISHED');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select outcome||':'||(publication_key is null)::text||':'||(private_display_path is null)::text from public.begin_gallery_publish('92000000-0000-4000-8000-000000000101')),'COMPLETE:true:true','PUBLISHED retry converges without server binding');
select throws_ok($$select public.update_gallery_draft('92000000-0000-4000-8000-000000000101','No edit','GALLERY',null)$$,'42501','gallery draft unavailable','published asset cannot be curated');

create temporary table first_retire as select * from public.begin_gallery_retire('92000000-0000-4000-8000-000000000101');
reset role;
select is((select outcome from first_retire),'WORK','PUBLISHED begins retirement work');
select is((select status::text from public.gallery_asset where public_id='92000000-0000-4000-8000-000000000101'),'RETIRING','begin retire persists RETIRING before Storage');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select publication_key from public.begin_gallery_retire('92000000-0000-4000-8000-000000000101')),(select publication_key from first_retire),'RETIRING retry reuses binding');
select is((select count(*) from public.list_gallery_assets_v3('20000000-0000-0000-0000-000000000001',100) where thumbnail_handle='92000000-0000-4000-8000-000000000101'),1::bigint,'RETIRING remains visible in OWNER list');
select is((select byte_size from public.resolve_gallery_thumbnail('92000000-0000-4000-8000-000000000101')),5,'RETIRING private thumbnail remains available');
select lives_ok(format('select public.finalize_gallery_retire(%L,%L)','92000000-0000-4000-8000-000000000101',(select publication_key from first_retire)),'matching binding finalizes retirement');
reset role;
select is((select status::text||':'||(retired_at is not null)::text from public.gallery_asset where public_id='92000000-0000-4000-8000-000000000101'),'RETIRED:true','finalize atomically timestamps RETIRED');
set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select outcome||':'||(publication_key is null)::text from public.begin_gallery_retire('92000000-0000-4000-8000-000000000101')),'COMPLETE:true','RETIRED retry converges without server binding');
select is((select count(*) from public.list_gallery_assets_v3('20000000-0000-0000-0000-000000000001',100) where thumbnail_handle='92000000-0000-4000-8000-000000000101'),0::bigint,'RETIRED is hidden from OWNER list');
select throws_ok($$select * from public.resolve_gallery_thumbnail('92000000-0000-4000-8000-000000000101')$$,'42501','thumbnail unavailable','RETIRED thumbnail no longer resolves');
reset role;
select is((select count(*) from public.gallery_variant where asset_id='62000000-0000-4000-8000-000000000101'),3::bigint,'retirement preserves all private variants');
reset role;
select throws_ok(format('update public.gallery_publication_binding set publication_key=%L where asset_id=%L','70000000-0000-4000-8000-000000000099','62000000-0000-4000-8000-000000000101'),'55000','gallery publication binding immutable','publication binding cannot change after creation');

select * from finish();
rollback;
