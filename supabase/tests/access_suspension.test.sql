begin;

select no_plan();

select has_type('public', 'membership_status', 'membership access status exists');
select enum_has_labels('public', 'membership_status', array['ACTIVE', 'SUSPENDED'], 'only active and suspended are valid');
select has_column('public', 'membership', 'status', 'membership persists access status');
select has_column('public', 'membership', 'access_changed_at', 'last access change records time');
select has_column('public', 'membership', 'access_changed_by', 'last access change records actor');
select ok(has_function_privilege('authenticated', 'public.set_artist_access(uuid,public.membership_status)', 'execute'), 'authenticated can request an identity-bound transition');
select ok(not has_function_privilege('anon', 'public.set_artist_access(uuid,public.membership_status)', 'execute'), 'anon cannot execute transition');
select ok(not has_function_privilege('service_role', 'public.set_artist_access(uuid,public.membership_status)', 'execute'), 'service role cannot bypass actor-bound transition');
select ok(not has_function_privilege('authenticated', 'private.assert_authenticated_owner(uuid)', 'execute'), 'gallery guard remains private after replacement');
select ok(not has_function_privilege('authenticated', 'private.assert_studio_owner(uuid,uuid)', 'execute'), 'service owner guard remains private after replacement');
select ok(not has_table_privilege('authenticated', 'public.membership', 'insert'), 'authenticated cannot insert membership directly');
select ok(not has_table_privilege('authenticated', 'public.membership', 'update'), 'authenticated cannot update membership directly');
select ok(not has_table_privilege('authenticated', 'public.membership', 'delete'), 'authenticated cannot delete membership directly');
select ok(
  has_table_privilege('service_role', 'public.membership', 'insert')
  and has_table_privilege('service_role', 'public.membership', 'update')
  and has_table_privilege('service_role', 'public.membership', 'delete'),
  'managed onboarding keeps service write access'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000099','authenticated','authenticated','south.suspension@example.test','',now(),'{}','{}',now(),now());
insert into public.user_profile(id,studio_id,user_id,display_name)
values('30000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000099','South artist');
insert into public.membership(id,studio_id,user_id,user_profile_id,role)
values('40000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000099','30000000-0000-0000-0000-000000000099','ARTIST');
insert into public.artist_profile(id,studio_id,membership_id,user_id,display_name)
values('50000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000099','South artist');

insert into public.customer(id,studio_id,name,status)
values('60000000-0000-4000-8000-000000000099','20000000-0000-0000-0000-000000000001','Retained customer','ACTIVE');
insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status)
values('70000000-0000-4000-8000-000000000099','20000000-0000-0000-0000-000000000001','60000000-0000-4000-8000-000000000099','Retained case','50000000-0000-0000-0000-000000000001','OPEN');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.membership), 2::bigint, 'owner lists only own studio memberships');
select throws_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000003', 'SUSPENDED') $$,
  '42501', 'artist access unavailable', 'owner cannot suspend a member of another tenant'
);
select throws_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000099', 'SUSPENDED') $$,
  '42501', 'artist access unavailable', 'owner cannot suspend an ARTIST of another tenant'
);
select throws_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000001', 'SUSPENDED') $$,
  '42501', 'artist access unavailable', 'owner cannot suspend self or another owner'
);
select throws_ok(
  $$ select public.set_artist_access(null, 'SUSPENDED') $$,
  '42501', 'artist access unavailable', 'null target fails closed'
);
select lives_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000002', 'SUSPENDED') $$,
  'owner suspends own artist'
);
select is((select status::text from public.membership where id='40000000-0000-0000-0000-000000000002'), 'SUSPENDED', 'membership is suspended');
select is((select access_changed_by from public.membership where id='40000000-0000-0000-0000-000000000002'), '10000000-0000-0000-0000-000000000001'::uuid, 'actor is recorded');
select ok((select access_changed_at is not null from public.membership where id='40000000-0000-0000-0000-000000000002'), 'transition time is recorded');
select set_config('app.test.member_ctid', (select ctid::text from public.membership where id='40000000-0000-0000-0000-000000000002'), true);
select lives_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000002', 'SUSPENDED') $$,
  'repeated suspension converges'
);
select is((select ctid::text from public.membership where id='40000000-0000-0000-0000-000000000002'), current_setting('app.test.member_ctid'), 'repeat does not rewrite membership');

reset role;
select is((select count(*) from auth.users where id='10000000-0000-0000-0000-000000000002'), 1::bigint, 'auth identity survives');
select is((select count(*) from public.membership where id='40000000-0000-0000-0000-000000000002'), 1::bigint, 'membership survives');
select is((select count(*) from public.user_profile where user_id='10000000-0000-0000-0000-000000000002'), 1::bigint, 'user profile survives');
select is((select count(*) from public.artist_profile where membership_id='40000000-0000-0000-0000-000000000002'), 1::bigint, 'artist profile survives');
select is((select count(*) from public.tattoo_case where id='70000000-0000-4000-8000-000000000099'), 1::bigint, 'related case survives');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.membership), 0::bigint, 'suspended artist cannot read membership under RLS');
select is((select count(*) from public.user_profile), 0::bigint, 'suspended artist cannot read profile under RLS');
select is((select count(*) from public.artist_profile), 0::bigint, 'suspended artist cannot read artist profile under RLS');
select throws_ok($$ select * from public.get_artist_agenda(now(), 50) $$, '42501', 'artist agenda unavailable', 'existing artist token cannot call agenda');
select throws_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000002', 'ACTIVE') $$,
  '42501', 'artist access unavailable', 'artist cannot restore own access'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000002', 'ACTIVE') $$,
  'owner restores the same artist identity'
);
select is((select status::text from public.membership where id='40000000-0000-0000-0000-000000000002'), 'ACTIVE', 'membership is active again');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.membership), 1::bigint, 'restored artist reads own membership');
select lives_ok($$ select * from public.get_artist_agenda(now(), 50) $$, 'restored artist can call agenda');

reset role;
set local role service_role;
update public.membership set status='SUSPENDED' where id='40000000-0000-0000-0000-000000000001';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.membership), 0::bigint, 'suspended OWNER cannot list members through RLS');
select throws_ok(
  $$ select public.set_artist_access('40000000-0000-0000-0000-000000000002', 'SUSPENDED') $$,
  '42501', 'artist access unavailable', 'suspended OWNER cannot mutate access'
);
select throws_ok(
  $$ select * from public.list_gallery_drafts_v2('20000000-0000-0000-0000-000000000001', 10) $$,
  '42501', 'gallery unavailable', 'suspended OWNER cannot call authenticated gallery RPC with old token'
);

reset role;
select throws_ok(
  $$ select private.assert_studio_owner('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$,
  '42501', 'owner authorization failed', 'suspended OWNER cannot pass service-side owner helper'
);

select * from finish();
rollback;
