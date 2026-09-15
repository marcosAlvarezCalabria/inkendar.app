begin;
select plan(27);

select has_table('public', 'booking_offer_public_access', 'public access table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.booking_offer_public_access'::regclass), 'public access RLS enabled');
select ok(not has_table_privilege('anon', 'public.booking_offer_public_access', 'select'), 'anonymous cannot read access rows');
select ok(not has_table_privilege('authenticated', 'public.booking_offer_public_access', 'select'), 'authenticated browser cannot read access rows');
select ok(not has_table_privilege('service_role', 'public.booking_offer_public_access', 'select'), 'service role must use guarded RPCs');
select ok(has_function_privilege('service_role', 'public.rotate_booking_offer_public_access(uuid,uuid,uuid,text,timestamptz)', 'execute'), 'service role can rotate access');
select ok(not has_function_privilege('authenticated', 'public.rotate_booking_offer_public_access(uuid,uuid,uuid,text,timestamptz)', 'execute'), 'authenticated cannot rotate access directly');
select ok(has_function_privilege('service_role', 'public.get_public_booking_offer(text,timestamptz)', 'execute'), 'service role can resolve public access');
select ok(not has_function_privilege('anon', 'public.get_public_booking_offer(text,timestamptz)', 'execute'), 'anonymous browser cannot call public lookup directly');
select is((select proconfig from pg_proc where oid = 'public.rotate_booking_offer_public_access(uuid,uuid,uuid,text,timestamptz)'::regprocedure), array['search_path=""'], 'rotation fixes an empty search path');
select is((select proconfig from pg_proc where oid = 'public.get_public_booking_offer(text,timestamptz)'::regprocedure), array['search_path=""'], 'public lookup fixes an empty search path');

set local role service_role;
insert into public.customer(id, studio_id, name, status) values ('60000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', 'Public access client', 'ACTIVE');
insert into public.tattoo_case(id, studio_id, customer_id, summary, artist_profile_id, status) values ('70000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000020', 'Private tattoo case', '50000000-0000-0000-0000-000000000001', 'OPEN');
create temporary table public_access_fixture(offer_id uuid primary key);
insert into public_access_fixture
select (public.create_booking_offer(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000020',
  '50000000-0000-0000-0000-000000000001',
  '[{"startUtc":"2026-09-20T09:00:00.000Z","endUtc":"2026-09-20T10:00:00.000Z"},{"startUtc":"2026-09-21T09:00:00.000Z","endUtc":"2026-09-21T10:00:00.000Z"}]',
  '2026-09-15T10:00:00Z'
)->>'id')::uuid;

select is(
  (public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', (select offer_id from public_access_fixture), repeat('ab', 32), '2026-09-15T10:01:00Z')->>'expires_at')::timestamptz,
  '2026-09-16T10:00:00Z'::timestamptz,
  'owner issues access only for a current OPEN offer'
);

reset role;
select is((select pg_typeof(token_hash)::text from public.booking_offer_public_access), 'bytea', 'access hash is stored as bytes');
select is((select encode(token_hash, 'hex') from public.booking_offer_public_access), repeat('ab', 32), 'only the SHA-256 value is stored');
select is((select count(*) from public.booking_offer_public_access), 1::bigint, 'one credential row exists for the offer');
set local role service_role;

select ok((select public.get_public_booking_offer(repeat('ab', 32), '2026-09-15T10:02:00Z') ?& array['expires_at', 'artist_display_name', 'time_zone', 'options']), 'public result contains the approved fields');
select ok((select not public.get_public_booking_offer(repeat('ab', 32), '2026-09-15T10:02:00Z') ?| array['id', 'studio_id', 'offer_id', 'artist_profile_id', 'tattoo_case_id', 'customer', 'conversation', 'contact', 'token_hash', 'provider', 'event', 'title']), 'public result excludes private and internal fields');
select is(jsonb_array_length(public.get_public_booking_offer(repeat('ab', 32), '2026-09-15T10:02:00Z')->'options'), 2, 'public result returns the held options');
select ok((select bool_and(not value ?| array['id', 'offer_id', 'studio_id', 'artist_profile_id', 'status']) from jsonb_array_elements(public.get_public_booking_offer(repeat('ab', 32), '2026-09-15T10:02:00Z')->'options')), 'public options contain no internal identifiers or status');

select lives_ok(format(
  'select public.rotate_booking_offer_public_access(%L,%L,%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  (select offer_id from public_access_fixture),
  repeat('cd', 32),
  '2026-09-15T10:03:00Z'
), 'owner rotates access atomically');
select is(public.get_public_booking_offer(repeat('ab', 32), '2026-09-15T10:04:00Z'), null::jsonb, 'rotation invalidates the previous hash immediately');
select isnt(public.get_public_booking_offer(repeat('cd', 32), '2026-09-15T10:04:00Z'), null::jsonb, 'rotated hash resolves the offer');
reset role;
select is((select count(*) from public.booking_offer_public_access), 1::bigint, 'rotation preserves a single credential row');
set local role service_role;

select throws_ok(format(
  'select public.rotate_booking_offer_public_access(%L,%L,%L,%L,%L)',
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  (select offer_id from public_access_fixture),
  repeat('ef', 32),
  '2026-09-15T10:05:00Z'
), 'P0002', null, 'cross-tenant offer rotation is rejected');
select throws_ok(format(
  'select public.rotate_booking_offer_public_access(%L,%L,%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  (select offer_id from public_access_fixture),
  repeat('ef', 32),
  '2026-09-15T10:05:00Z'
), '42501', null, 'ARTIST cannot rotate access');
select throws_ok($$select public.get_public_booking_offer('ABC', '2026-09-15T10:05:00Z')$$, '22023', null, 'non-canonical hashes are rejected');
select is(public.get_public_booking_offer(repeat('cd', 32), '2026-09-16T10:00:00Z'), null::jsonb, 'access fails uniformly at exact offer expiry');

select * from finish();
rollback;
