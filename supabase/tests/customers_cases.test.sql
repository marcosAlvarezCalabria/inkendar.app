begin;

select plan(58);

select has_table('public', 'customer', 'customer table exists');
select has_table('public', 'tattoo_case', 'tattoo_case table exists');
select has_type('public', 'customer_status', 'customer status enum exists');
select enum_has_labels('public', 'customer_status', array['ACTIVE', 'ARCHIVED'], 'customer status is minimal');
select has_type('public', 'tattoo_case_status', 'tattoo case status enum exists');
select enum_has_labels('public', 'tattoo_case_status', array['OPEN', 'ARCHIVED'], 'tattoo case status is minimal');
select has_column('public', 'customer', 'studio_id', 'customer is tenant scoped');
select has_column('public', 'tattoo_case', 'studio_id', 'tattoo case is tenant scoped');
select col_is_fk('public', 'customer', 'studio_id', 'customer belongs to studio');
select col_is_fk('public', 'tattoo_case', 'studio_id', 'tattoo case belongs to studio');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tattoo_case'::regclass and conname = 'tattoo_case_customer_same_studio_fk'),
  'FOREIGN KEY (customer_id, studio_id) REFERENCES customer(id, studio_id) ON DELETE RESTRICT',
  'tattoo case belongs to a customer in the same studio'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tattoo_case'::regclass and conname = 'tattoo_case_artist_same_studio_fk'),
  'FOREIGN KEY (artist_profile_id, studio_id) REFERENCES artist_profile(id, studio_id) ON DELETE RESTRICT',
  'tattoo case may belong to an artist in the same studio'
);

set local role service_role;

insert into public.customer (id, studio_id, name, email, phone)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'North Client', 'north.client@example.test', '+34600000001'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'South Client', 'south.client@example.test', '+34600000002');

insert into public.tattoo_case (id, studio_id, customer_id, summary, artist_profile_id)
values ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'North floral case', '50000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary) values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Cross tenant customer') $$,
  '23503', null, 'database rejects a cross-tenant customer even for service_role'
);

select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary, artist_profile_id) values ('20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'Cross tenant artist', '50000000-0000-0000-0000-000000000001') $$,
  '23503', null, 'database rejects a cross-tenant artist even for service_role'
);

select throws_ok(
  $$ insert into public.customer (studio_id, name, email) values ('20000000-0000-0000-0000-000000000001', 'Duplicate contact', 'north.client@example.test') $$,
  '23505', null, 'email is unique inside one studio'
);

select lives_ok(
  $$ insert into public.customer (studio_id, name, email) values ('20000000-0000-0000-0000-000000000002', 'Same contact elsewhere', 'north.client@example.test') $$,
  'the same normalized contact may exist in another studio'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select results_eq($$ select name from public.customer order by name $$, $$ values ('North Client'::text) $$, 'owner lists only own customers');
select results_eq($$ select summary from public.tattoo_case $$, $$ values ('North floral case'::text) $$, 'owner lists only own cases');
select lives_ok($$ insert into public.customer (studio_id, name) values ('20000000-0000-0000-0000-000000000001', 'Owner Created') $$, 'owner creates customer in own studio');
select results_eq($$ update public.customer set status = 'ARCHIVED' where id = '60000000-0000-0000-0000-000000000001' returning status::text $$, $$ values ('ARCHIVED'::text) $$, 'owner archives own customer');
select results_eq($$ update public.customer set name = 'Forbidden' where studio_id = '20000000-0000-0000-0000-000000000002' returning id $$, $$ select null::uuid where false $$, 'owner cannot update another tenant customer');
select throws_ok(
  $$ insert into public.customer (studio_id, name) values ('20000000-0000-0000-0000-000000000002', 'Forbidden') $$,
  '42501', 'new row violates row-level security policy for table "customer"', 'owner cannot create another tenant customer'
);
select results_eq(
  $$ insert into public.tattoo_case (id, studio_id, customer_id, summary) values ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Owner created case') returning summary $$,
  $$ values ('Owner created case'::text) $$,
  'owner creates a case in own studio'
);
select results_eq(
  $$ update public.tattoo_case set status = 'ARCHIVED' where id = '70000000-0000-0000-0000-000000000002' returning status::text $$,
  $$ values ('ARCHIVED'::text) $$,
  'owner archives own case'
);
select results_eq(
  $$ update public.tattoo_case set summary = 'Forbidden' where studio_id = '20000000-0000-0000-0000-000000000002' returning id $$,
  $$ select null::uuid where false $$,
  'owner cannot update another tenant case'
);
select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary) values ('20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'Forbidden tenant case') $$,
  '42501', 'new row violates row-level security policy for table "tattoo_case"', 'owner cannot create a case in another tenant'
);
select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary) values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Cross tenant customer as owner') $$,
  '23503', null, 'owner cannot link a case to a customer from another tenant'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select results_eq($$ select id from public.customer $$, $$ select null::uuid where false $$, 'artist cannot read customers');
select results_eq($$ select id from public.tattoo_case $$, $$ select null::uuid where false $$, 'artist cannot read cases');
select results_eq($$ update public.customer set name = 'Artist write' returning id $$, $$ select null::uuid where false $$, 'artist cannot update customers');
select throws_ok($$ insert into public.customer (studio_id, name) values ('20000000-0000-0000-0000-000000000001', 'Artist create') $$, '42501', null, 'artist cannot create customers');
select results_eq($$ update public.tattoo_case set summary = 'Artist write' returning id $$, $$ select null::uuid where false $$, 'artist cannot update cases');
select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary) values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Artist create') $$,
  '42501', 'new row violates row-level security policy for table "tattoo_case"', 'artist cannot create cases'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

select results_eq($$ select name from public.customer where id = '60000000-0000-0000-0000-000000000001' $$, $$ select null::text where false $$, 'another tenant owner cannot read first tenant customer');
select results_eq($$ select summary from public.tattoo_case where id = '70000000-0000-0000-0000-000000000001' $$, $$ select null::text where false $$, 'another tenant owner cannot read first tenant case');
select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary, artist_profile_id) values ('20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'Cross tenant artist as owner', '50000000-0000-0000-0000-000000000001') $$,
  '23503', null, 'owner cannot assign an artist from another tenant'
);

reset role;
set local role anon;

select throws_ok($$ select * from public.customer $$, '42501', null, 'anon cannot read customers');
select throws_ok($$ select * from public.tattoo_case $$, '42501', null, 'anon cannot read cases');
select throws_ok($$ insert into public.customer (studio_id, name) values ('20000000-0000-0000-0000-000000000001', 'Anonymous') $$, '42501', null, 'anon cannot create customers');
select throws_ok($$ update public.tattoo_case set summary = 'Anonymous write' $$, '42501', 'permission denied for table tattoo_case', 'anon cannot update cases');
select throws_ok(
  $$ insert into public.tattoo_case (studio_id, customer_id, summary) values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Anonymous') $$,
  '42501', 'permission denied for table tattoo_case', 'anon cannot create cases'
);

reset role;
select ok((select relrowsecurity from pg_class where oid = 'public.customer'::regclass), 'RLS is enabled on customer');
select ok((select relrowsecurity from pg_class where oid = 'public.tattoo_case'::regclass), 'RLS is enabled on tattoo_case');
select ok(not has_table_privilege('authenticated', 'public.customer', 'delete'), 'authenticated cannot delete customers');
select ok(not has_table_privilege('authenticated', 'public.tattoo_case', 'delete'), 'authenticated cannot delete cases');
select ok(not has_table_privilege('anon', 'public.customer', 'delete'), 'anon cannot delete customers');
select ok(not has_table_privilege('anon', 'public.tattoo_case', 'delete'), 'anon cannot delete cases');
select has_index('public', 'customer', 'customer_studio_email_unique', 'customer tenant/email unique index exists');
select has_index('public', 'customer', 'customer_studio_phone_unique', 'customer tenant/phone unique index exists');
select has_index('public', 'customer', 'customer_studio_status_idx', 'customer tenant/status index exists');
select has_index('public', 'tattoo_case', 'tattoo_case_studio_status_idx', 'case tenant/status index exists');
select has_index('public', 'tattoo_case', 'tattoo_case_studio_customer_idx', 'case tenant/customer index exists');
select has_index('public', 'tattoo_case', 'tattoo_case_studio_artist_idx', 'case tenant/artist index exists');
select ok((select indisunique from pg_index where indexrelid = 'public.customer_studio_email_unique'::regclass), 'customer tenant/email partial index is unique');
select ok((select indisunique from pg_index where indexrelid = 'public.customer_studio_phone_unique'::regclass), 'customer tenant/phone partial index is unique');
select is(
  (select pg_get_expr(indpred, indrelid) from pg_index where indexrelid = 'public.customer_studio_email_unique'::regclass),
  '(email IS NOT NULL)',
  'customer tenant/email unique index excludes nulls'
);
select is(
  (select pg_get_expr(indpred, indrelid) from pg_index where indexrelid = 'public.customer_studio_phone_unique'::regclass),
  '(phone IS NOT NULL)',
  'customer tenant/phone unique index excludes nulls'
);
select is(
  (select pg_get_expr(indpred, indrelid) from pg_index where indexrelid = 'public.tattoo_case_studio_artist_idx'::regclass),
  '(artist_profile_id IS NOT NULL)',
  'case tenant/artist index excludes unassigned cases'
);

select * from finish();
rollback;
