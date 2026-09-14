begin;
select plan(44);

select has_table('public', 'integration_connection', 'connection table exists');
select has_table('public', 'conversation_link', 'conversation link table exists');
select has_table('public', 'outbound_message_operation', 'outbound operation table exists');
select enum_has_labels('public', 'outbound_message_status', array['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'], 'outbound status models ambiguity');
select ok((select relrowsecurity from pg_class where oid = 'public.integration_connection'::regclass), 'connection RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_link'::regclass), 'link RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.outbound_message_operation'::regclass), 'operation RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.conversation_link', 'insert'), 'authenticated cannot insert links directly');
select ok(not has_table_privilege('authenticated', 'public.conversation_link', 'update'), 'authenticated cannot update links directly');
select ok(not has_table_privilege('authenticated', 'public.conversation_link', 'delete'), 'authenticated cannot delete links directly');
select ok(not has_table_privilege('authenticated', 'public.outbound_message_operation', 'insert'), 'authenticated cannot insert operations directly');
select ok(not has_table_privilege('authenticated', 'public.outbound_message_operation', 'update'), 'authenticated cannot update operations directly');
select ok(not has_table_privilege('authenticated', 'public.outbound_message_operation', 'delete'), 'authenticated cannot delete operations directly');
select ok(not has_function_privilege('authenticated', 'public.upsert_conversation_links(uuid,uuid,bigint[])', 'execute'), 'authenticated cannot upsert links through RPC');
select ok(not has_function_privilege('authenticated', 'public.claim_outbound_message_operation(uuid,uuid,bigint,uuid)', 'execute'), 'authenticated cannot claim through RPC');
select ok(not has_function_privilege('authenticated', 'public.transition_outbound_message_operation(uuid,uuid,outbound_message_status,bigint)', 'execute'), 'authenticated cannot transition through RPC');
select ok(has_function_privilege('service_role', 'public.upsert_conversation_links(uuid,uuid,bigint[])', 'execute'), 'service role can upsert links');
select ok(has_function_privilege('service_role', 'public.claim_outbound_message_operation(uuid,uuid,bigint,uuid)', 'execute'), 'service role can claim');
select ok(has_function_privilege('service_role', 'public.transition_outbound_message_operation(uuid,uuid,outbound_message_status,bigint)', 'execute'), 'service role can transition');

set local role service_role;
insert into public.integration_connection (id, studio_id, external_account_id, credential_reference) values
 ('80000000-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000001', 7, 'studio-north'),
 ('80000000-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 8, 'studio-south');
select lives_ok($$ select public.upsert_conversation_links('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', array[42,43]::bigint[]) $$, 'service role creates links atomically');
select results_eq($$ select external_conversation_id from public.conversation_link where studio_id = '20000000-0000-0000-0000-000000000001' order by 1 $$, $$ values (42::bigint), (43::bigint) $$, 'only opaque link ids are stored');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 42, '90000000-0000-4000-8000-000000000001') $$, $$ values ('CLAIMED'::text) $$, 'first claim wins');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 42, '90000000-0000-4000-8000-000000000001') $$, $$ values ('PENDING'::text) $$, 'concurrent duplicate stays pending and is not reopened');
select lives_ok($$ select public.transition_outbound_message_operation('20000000-0000-0000-0000-000000000001', (select id from public.outbound_message_operation where idempotency_key = '90000000-0000-4000-8000-000000000001'), 'SUCCEEDED', 99) $$, 'pending operation transitions to succeeded');
select results_eq($$ select claim_status, external_message_id from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 42, '90000000-0000-4000-8000-000000000001') $$, $$ values ('SUCCEEDED'::text, 99::bigint) $$, 'succeeded claim is returned without reopening');
select throws_ok($$ select public.transition_outbound_message_operation('20000000-0000-0000-0000-000000000001', (select id from public.outbound_message_operation where idempotency_key = '90000000-0000-4000-8000-000000000001'), 'UNKNOWN', null) $$, '23514', null, 'final succeeded operation cannot transition');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 43, '90000000-0000-4000-8000-000000000002') $$, $$ values ('CLAIMED'::text) $$, 'second key is claimed');
select lives_ok($$ select public.transition_outbound_message_operation('20000000-0000-0000-0000-000000000001', (select id from public.outbound_message_operation where idempotency_key = '90000000-0000-4000-8000-000000000002'), 'UNKNOWN', null) $$, 'pending operation transitions to unknown');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 43, '90000000-0000-4000-8000-000000000002') $$, $$ values ('UNKNOWN'::text) $$, 'unknown claim is not reopened');
select throws_ok($$ select public.transition_outbound_message_operation('20000000-0000-0000-0000-000000000001', (select id from public.outbound_message_operation where idempotency_key = '90000000-0000-4000-8000-000000000002'), 'FAILED', null) $$, '23514', null, 'unknown operation cannot transition');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 44, '90000000-0000-4000-8000-000000000003') $$, $$ values ('CLAIMED'::text) $$, 'third key is claimed');
select lives_ok($$ select public.transition_outbound_message_operation('20000000-0000-0000-0000-000000000001', (select id from public.outbound_message_operation where idempotency_key = '90000000-0000-4000-8000-000000000003'), 'FAILED', null) $$, 'pending operation transitions to failed');
select results_eq($$ select claim_status from public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 44, '90000000-0000-4000-8000-000000000003') $$, $$ values ('FAILED'::text) $$, 'failed claim is not reopened');
select throws_ok($$ select public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000002', 52, '90000000-0000-4000-8000-000000000004') $$, '42501', null, 'cross-tenant tuple cannot claim');

reset role; set local role authenticated; select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select results_eq($$ select external_account_id from public.integration_connection $$, $$ values (7::bigint) $$, 'owner sees own connection');
select results_eq($$ select external_conversation_id from public.conversation_link order by 1 $$, $$ values (42::bigint), (43::bigint), (44::bigint) $$, 'owner sees own links');
select throws_ok($$ insert into public.conversation_link (studio_id, integration_connection_id, external_conversation_id) values ('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 55) $$, '42501', null, 'owner cannot write links directly');
select throws_ok($$ select public.claim_outbound_message_operation('20000000-0000-0000-0000-000000000001', '80000000-0000-4000-8000-000000000001', 42, '90000000-0000-4000-8000-000000000005') $$, '42501', null, 'owner cannot execute claim RPC');

reset role; set local role anon;
select throws_ok($$ select * from public.integration_connection $$, '42501', null, 'anon cannot read connections');
select throws_ok($$ select * from public.conversation_link $$, '42501', null, 'anon cannot read links');
select throws_ok($$ select * from public.outbound_message_operation $$, '42501', null, 'anon cannot read operations');

reset role;
select has_index('public', 'integration_connection', 'integration_connection_active_studio_unique', 'active connection index exists');
select has_index('public', 'conversation_link', 'conversation_link_studio_external_idx', 'link lookup index exists');
select has_index('public', 'outbound_message_operation', 'outbound_message_conversation_idx', 'operation lookup index exists');
select * from finish();
rollback;
