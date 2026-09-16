begin;
select plan(22);

select has_table('public','gallery_asset','gallery asset table exists');
select has_table('public','gallery_variant','gallery variant table exists');
select ok((select relrowsecurity from pg_class where oid='public.gallery_asset'::regclass),'asset RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.gallery_variant'::regclass),'variant RLS enabled');
select ok(not has_table_privilege('authenticated','public.gallery_asset','select'),'authenticated has no direct asset access');
select ok(not has_table_privilege('service_role','public.gallery_asset','select'),'service role has no direct asset access');
select ok(has_function_privilege('authenticated','public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb)','execute'),'authenticated may call identity-bound create');
select ok(not has_function_privilege('service_role','public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb)','execute'),'service role cannot impersonate an owner');
select ok(has_function_privilege('authenticated','public.list_gallery_drafts_v2(uuid,integer)','execute'),'authenticated may call identity-bound list');
select ok(not has_function_privilege('anon','public.list_gallery_drafts_v2(uuid,integer)','execute'),'anonymous cannot list drafts');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000001','GALLERY',null,'Pieza general','[{"kind":"MASTER","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000001/master.webp","width":1200,"height":800,"mime_type":"image/webp","byte_size":100},{"kind":"DISPLAY","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000001/display.webp","width":1200,"height":800,"mime_type":"image/webp","byte_size":80},{"kind":"THUMB","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000001/thumb.webp","width":480,"height":320,"mime_type":"image/webp","byte_size":40}]')$$,'owner creates gallery draft');
select lives_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000002','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000001','Pieza artista','[{"kind":"MASTER","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000002/master.webp","width":800,"height":1200,"mime_type":"image/webp","byte_size":100},{"kind":"DISPLAY","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000002/display.webp","width":800,"height":1200,"mime_type":"image/webp","byte_size":80},{"kind":"THUMB","path":"20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000002/thumb.webp","width":320,"height":480,"mime_type":"image/webp","byte_size":40}]')$$,'owner creates same-tenant portfolio draft');
select is((select count(*) from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100)),2::bigint,'owner lists only own drafts');
select is((select string_agg(position::text,',' order by position) from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100)),'1,1'::text,'positions are stable per target');
select throws_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000003','ARTIST_PORTFOLIO',null,'Invalid','[]')$$,'22023','gallery draft invalid','portfolio requires artist and complete variants');
select throws_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000003','GALLERY','50000000-0000-0000-0000-000000000001','Invalid','[]')$$,'22023','gallery draft invalid','general gallery forbids artist');
select throws_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000003','ARTIST_PORTFOLIO','50000000-0000-0000-0000-000000000006','Cross tenant','[]')$$,'22023','gallery draft invalid','cross-tenant artist fails closed');
select throws_ok($$select * from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',101)$$,'22023','gallery draft invalid','list limit is bounded');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select * from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100)$$,'42501','gallery unavailable','artist cannot list');
select throws_ok($$select public.create_gallery_draft('20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000003','GALLERY',null,'Spoof','[]')$$,'42501','gallery unavailable','artist cannot spoof owner');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select * from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100)$$,'42501','gallery unavailable','cross-tenant owner cannot list');

reset role; set local role service_role;
select throws_ok($$select * from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001',100)$$,'42501',null,'service role misuse fails closed');

select * from finish();
rollback;
