begin;
select plan(34);

select has_table('public', 'google_oauth_attempt', 'oauth attempt table exists');
select has_table('public', 'google_calendar_connection', 'connection table exists');
select has_table('public', 'artist_calendar_assignment', 'assignment table exists');
select has_type('public', 'google_calendar_connection_status', 'connection status exists');
select enum_has_labels('public', 'google_calendar_connection_status', array['ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED'], 'connection status is minimal');
select ok((select relrowsecurity from pg_class where oid = 'public.google_oauth_attempt'::regclass), 'attempt RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.google_calendar_connection'::regclass), 'connection RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.artist_calendar_assignment'::regclass), 'assignment RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.google_calendar_connection', 'select'), 'authenticated cannot read encrypted token');
select ok(not has_table_privilege('service_role', 'public.google_calendar_connection', 'select'), 'service role uses guarded RPC instead of direct token reads');
select ok(has_function_privilege('service_role', 'public.create_google_oauth_attempt(text,uuid,uuid,timestamp with time zone)', 'execute'), 'service role can create attempts');
select ok(not has_function_privilege('authenticated', 'public.create_google_oauth_attempt(text,uuid,uuid,timestamp with time zone)', 'execute'), 'authenticated cannot create attempts directly');
select ok(not has_function_privilege('authenticated', 'public.get_google_calendar_connection(uuid,uuid)', 'execute'), 'authenticated cannot retrieve encrypted connection');

set local role service_role;
select lives_ok($$ select public.create_google_oauth_attempt(repeat('a', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() + interval '10 minutes') $$, 'owner-bound attempt is created');
select is(public.consume_google_oauth_attempt(repeat('a', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now()), true, 'fresh attempt consumed');
select is(public.consume_google_oauth_attempt(repeat('a', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now()), false, 'attempt is one use');
select throws_ok($$ select public.create_google_oauth_attempt(repeat('b', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', now() + interval '10 minutes') $$, '42501', null, 'artist cannot be asserted as owner');
select throws_ok($$ select public.create_google_oauth_attempt(repeat('c', 64), '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', now() + interval '10 minutes') $$, '42501', null, 'owner cannot bind another tenant');
select lives_ok($$ select public.create_google_oauth_attempt(repeat('d', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() + interval '1 minute') $$, 'short attempt created');
select is(public.consume_google_oauth_attempt(repeat('d', 64), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() + interval '2 minutes'), false, 'expired attempt rejected');

select lives_ok($$ select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'v1.synthetic-ciphertext.tag', array['https://www.googleapis.com/auth/calendar.calendarlist.readonly']) $$, 'owner activates encrypted connection');
select results_eq($$ select status::text from public.get_google_calendar_connection('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$, $$ values ('ACTIVE'::text) $$, 'owner reads active state via guarded RPC');
select throws_ok($$ select * from public.get_google_calendar_connection('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002') $$, '42501', null, 'artist cannot read connection through service RPC');
select lives_ok($$ select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'artist@example.test') $$, 'owner assigns own artist');
select results_eq($$ select calendar_id from public.list_artist_calendar_assignments('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') where artist_profile_id = '50000000-0000-0000-0000-000000000001' $$, $$ values ('artist@example.test'::text) $$, 'assignment returned through guarded RPC');
select throws_ok($$ select public.assign_artist_calendar('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'cross@example.test') $$, 'P0002', null, 'cross-tenant artist rejected');
select lives_ok($$ select public.mark_google_calendar_reauth_required('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$, 'invalid credential marks reauthorization required');
select is((select count(*) from public.list_artist_calendar_assignments('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') where calendar_id is not null), 1::bigint, 'reauthorization preserves assignments');
select throws_ok($$ select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'blocked@example.test') $$, 'P0002', null, 'reauthorization blocks assignment changes');
select lives_ok($$ select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'v1.new-synthetic-ciphertext.tag', array['https://www.googleapis.com/auth/calendar.calendarlist.readonly']) $$, 'reauthorization restores active connection without clearing assignment');
select lives_ok($$ select public.disconnect_google_calendar('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$, 'owner disconnects');
select results_eq($$ select status::text, refresh_token_ciphertext from public.get_google_calendar_connection('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$, $$ values ('DISCONNECTED'::text, null::text) $$, 'disconnect clears token');
select is((select count(*) from public.list_artist_calendar_assignments('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') where calendar_id is not null), 0::bigint, 'disconnect clears assignments');
select throws_ok($$ select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'inactive@example.test') $$, 'P0002', null, 'inactive connection cannot receive assignment');

select * from finish();
rollback;
