begin;

select plan(20);

select has_table('public', 'conversation_outbound_operation', 'outbound operations exist');
select has_column('public', 'conversation_outbound_operation', 'idempotency_key', 'operation stores an opaque key');
select hasnt_column('public', 'conversation_outbound_operation', 'content', 'operation never stores reply content');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_outbound_operation'::regclass), 'outbound RLS is enabled');
select ok(has_table_privilege('authenticated', 'public.conversation_outbound_operation', 'select'), 'authenticated may select through RLS');
select ok(not has_table_privilege('authenticated', 'public.conversation_outbound_operation', 'insert'), 'authenticated cannot insert operations');
select ok(not has_table_privilege('authenticated', 'public.conversation_outbound_operation', 'update'), 'authenticated cannot update operations');
select ok(not has_table_privilege('authenticated', 'public.conversation_outbound_operation', 'delete'), 'authenticated cannot delete operations');
select ok(not has_function_privilege('authenticated', 'public.claim_conversation_outbound_operation(uuid,text,text,text,uuid)', 'execute'), 'authenticated cannot claim');
select ok(not has_function_privilege('authenticated', 'public.transition_conversation_outbound_operation(uuid,uuid,conversation_outbound_status,text)', 'execute'), 'authenticated cannot transition');
select ok(has_function_privilege('service_role', 'public.claim_conversation_outbound_operation(uuid,text,text,text,uuid)', 'execute'), 'service role may claim');
select ok(has_function_privilege('service_role', 'public.transition_conversation_outbound_operation(uuid,uuid,conversation_outbound_status,text)', 'execute'), 'service role may transition');

set local role service_role;

select results_eq(
  $$ select claim_status from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '42', '90000000-0000-4000-8000-000000000001') $$,
  $$ values ('CLAIMED'::text) $$,
  'first submission atomically claims the key'
);
select results_eq(
  $$ select claim_status from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '42', '90000000-0000-4000-8000-000000000001') $$,
  $$ values ('PENDING'::text) $$,
  'concurrent or repeated pending key is not reclaimed'
);
select throws_ok(
  $$ select * from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '43', '90000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'one key cannot be reused for another conversation'
);
select lives_ok(
  $$ select public.transition_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', (select id from public.conversation_outbound_operation where idempotency_key = '90000000-0000-4000-8000-000000000001'), 'FAILED', null) $$,
  'pending operation may finish failed'
);
select results_eq(
  $$ select claim_status from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '42', '90000000-0000-4000-8000-000000000001') $$,
  $$ values ('FAILED'::text) $$,
  'failed key remains stable'
);
select throws_ok(
  $$ select public.transition_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', (select id from public.conversation_outbound_operation where idempotency_key = '90000000-0000-4000-8000-000000000001'), 'SUCCEEDED', '84') $$,
  '23514', null, 'final failed operation cannot reopen'
);
select lives_ok(
  $$ with claim as (select operation_id from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '42', '90000000-0000-4000-8000-000000000002')) select public.transition_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', operation_id, 'SUCCEEDED', '84') from claim $$,
  'a new key supports a conscious retry and success'
);
select results_eq(
  $$ select claim_status, external_message_id from public.claim_conversation_outbound_operation('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '42', '90000000-0000-4000-8000-000000000002') $$,
  $$ values ('SUCCEEDED'::text, '84'::text) $$,
  'succeeded key reuses the recorded provider result'
);

select * from finish();
rollback;
