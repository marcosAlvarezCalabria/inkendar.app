begin;
select plan(41);

select has_table('public', 'integration_connection', 'connection table exists');
select has_table('public', 'conversation_link', 'conversation link table exists');
select has_table('public', 'outbound_message_operation', 'outbound operation table exists');
select has_type('public', 'integration_connection_status', 'connection status exists');
select enum_has_labels('public', 'integration_connection_status', array['ACTIVE', 'DISABLED'], 'connection status is minimal');
select has_type('public', 'outbound_message_status', 'outbound status exists');
select enum_has_labels('public', 'outbound_message_status', array['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'], 'outbound status models ambiguity');
select has_column('public', 'integration_connection', 'studio_id', 'connection is tenant scoped');
select has_column('public', 'conversation_link', 'studio_id', 'link is tenant scoped');
select has_column('public', 'outbound_message_operation', 'studio_id', 'operation is tenant scoped');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'conversation_link_connection_same_studio_fk'), 'FOREIGN KEY (integration_connection_id, studio_id) REFERENCES integration_connection(id, studio_id) ON DELETE RESTRICT', 'link connection FK keeps tenant');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'outbound_message_conversation_same_studio_fk'), 'FOREIGN KEY (conversation_link_id, studio_id) REFERENCES conversation_link(id, studio_id) ON DELETE RESTRICT', 'operation link FK keeps tenant');
select ok((select relrowsecurity from pg_class where oid = 'public.integration_connection'::regclass), 'connection RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_link'::regclass), 'link RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.outbound_message_operation'::regclass), 'operation RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.integration_connection', 'insert'), 'owner cannot configure a connection directly');
select ok(not has_table_privilege('authenticated', 'public.integration_connection', 'update'), 'owner cannot alter connection metadata');

set local role service_role;
insert into public.integration_connection (id, studio_id, external_account_id, credential_reference) values
 ('80000000-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000001', 7, 'studio-north'),
 ('80000000-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 8, 'studio-south');
insert into public.conversation_link (id, studio_id, integration_connection_id, external_conversation_id) values
 ('81000000-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', '80000000-0000-4000-8000-000000000002', 52);

reset role; set local role anon;
select throws_ok($$ select * from public.integration_connection $$, '42501', null, 'anon cannot read connections');
select throws_ok($$ select * from public.conversation_link $$, '42501', null, 'anon cannot read links');
select throws_ok($$ select * from public.outbound_message_operation $$, '42501', null, 'anon cannot read operations');

reset role; set local role authenticated; select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select results_eq($$ select external_account_id from public.integration_connection $$, $$ values (7::bigint) $$, 'owner sees own connection');
select results_eq($$ select external_account_id from public.integration_connection where external_account_id = 8 $$, $$ select null::bigint where false $$, 'owner cannot see another connection');
select lives_ok($$ insert into public.conversation_link (id, studio_id, integration_connection_id, external_conversation_id) values ('81000000-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 42) $$, 'owner links own conversation');
select throws_ok($$ insert into public.conversation_link (studio_id, integration_connection_id, external_conversation_id) values ('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000002', 99) $$, '23503', null, 'composite FK rejects cross-tenant connection');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '81000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001') $$, $$ values ('CLAIMED'::text) $$, 'first key is claimed');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '81000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001') $$, $$ values ('PENDING'::text) $$, 'concurrent duplicate is blocked');
select lives_ok($$ update public.outbound_message_operation set status = 'SUCCEEDED', external_message_id = 99 where idempotency_key = '90000000-0000-4000-8000-000000000001' $$, 'operation can record confirmed external id');
select results_eq($$ select claim_status, external_message_id from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '81000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001') $$, $$ values ('SUCCEEDED'::text, 99::bigint) $$, 'successful duplicate returns prior result');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '81000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002') $$, $$ values ('CLAIMED'::text) $$, 'second key is claimed');
select lives_ok($$ update public.outbound_message_operation set status = 'UNKNOWN' where idempotency_key = '90000000-0000-4000-8000-000000000002' $$, 'ambiguous operation is recorded without content');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '81000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002') $$, $$ values ('UNKNOWN'::text) $$, 'unknown operation cannot be resent silently');

reset role; set local role authenticated; select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select results_eq($$ select id from public.integration_connection $$, $$ select null::uuid where false $$, 'artist cannot read connection');
select results_eq($$ select id from public.conversation_link $$, $$ select null::uuid where false $$, 'artist cannot read links');
select results_eq($$ select id from public.outbound_message_operation $$, $$ select null::uuid where false $$, 'artist cannot read operations');
select throws_ok($$ insert into public.conversation_link (studio_id, integration_connection_id, external_conversation_id) values ('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 77) $$, '42501', null, 'artist cannot create links');

reset role;
select ok(not has_table_privilege('authenticated', 'public.integration_connection', 'delete'), 'authenticated cannot delete connections');
select ok(not has_table_privilege('authenticated', 'public.conversation_link', 'delete'), 'authenticated cannot delete links');
select ok(not has_table_privilege('authenticated', 'public.outbound_message_operation', 'delete'), 'authenticated cannot delete operations');
select has_index('public', 'integration_connection', 'integration_connection_active_studio_unique', 'active connection index exists');
select has_index('public', 'conversation_link', 'conversation_link_studio_external_idx', 'link lookup index exists');
select has_index('public', 'outbound_message_operation', 'outbound_message_conversation_idx', 'operation lookup index exists');

select * from finish();
rollback;
