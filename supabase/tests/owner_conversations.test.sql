begin;

select plan(34);

select has_table('public', 'conversation_link', 'conversation links exist');
select has_table('public', 'conversation_webhook_receipt', 'webhook receipts exist');
select has_column('public', 'conversation_link', 'studio_id', 'conversation link is tenant scoped');
select has_column('public', 'conversation_link', 'customer_id', 'conversation link belongs to a customer');
select has_column('public', 'conversation_link', 'tattoo_case_id', 'conversation link may belong to a case');
select hasnt_column('public', 'conversation_webhook_receipt', 'content', 'receipt does not copy message content');
select hasnt_column('public', 'conversation_webhook_receipt', 'payload', 'receipt does not copy provider payload');
select has_index('public', 'conversation_link', 'conversation_link_studio_activity_idx', 'tenant activity index exists');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_link'::regclass), 'link RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_webhook_receipt'::regclass), 'receipt RLS is enabled');
select has_index('public', 'conversation_link', 'conversation_link_provider_identity_unique', 'one provider conversation link exists per studio');
select has_index('public', 'conversation_webhook_receipt', 'conversation_webhook_receipt_delivery_unique', 'delivery id deduplication index exists');
select ok(not has_table_privilege('authenticated', 'public.conversation_link', 'delete'), 'authenticated cannot delete links');
select ok(not has_table_privilege('authenticated', 'public.conversation_webhook_receipt', 'select'), 'authenticated cannot read receipts');
select ok(not has_table_privilege('anon', 'public.conversation_webhook_receipt', 'insert'), 'anon cannot insert receipts');
select ok(has_function_privilege('service_role', 'public.ingest_conversation_webhook(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'execute'), 'service role executes ingestion RPC');
select ok(not has_function_privilege('authenticated', 'public.ingest_conversation_webhook(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'execute'), 'authenticated cannot execute ingestion RPC');
select ok(not has_function_privilege('anon', 'public.ingest_conversation_webhook(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'execute'), 'anon cannot execute ingestion RPC');

set local role service_role;

insert into public.customer (id, studio_id, name)
values
  ('60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'North conversation client'),
  ('60000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', 'South conversation client');

insert into public.tattoo_case (id, studio_id, customer_id, summary)
values
  ('70000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011', 'North conversation case'),
  ('70000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000012', 'South conversation case');

select throws_ok(
  $$ insert into public.conversation_link (studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id) values ('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '7', '40', '60000000-0000-0000-0000-000000000012') $$,
  '23503', null, 'database rejects a cross-tenant customer link'
);
select throws_ok(
  $$ insert into public.conversation_link (studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id, tattoo_case_id) values ('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '7', '41', '60000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000012') $$,
  '23503', null, 'database rejects a cross-tenant case link'
);
select throws_ok(
  $$ insert into public.conversation_link (studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id, tattoo_case_id) values ('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '7', '41', '60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000011') $$,
  '23503', null, 'database rejects a case belonging to another customer'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ insert into public.conversation_link (id, studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id, tattoo_case_id) values ('80000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '7', '42', '60000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000011') $$,
  'owner links an own-studio conversation'
);
select results_eq($$ select external_conversation_id from public.conversation_link $$, $$ values ('42'::text) $$, 'owner reads only own links');
select throws_ok(
  $$ insert into public.conversation_link (studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id) values ('20000000-0000-0000-0000-000000000002', 'chatwoot', '4', '8', '43', '60000000-0000-0000-0000-000000000012') $$,
  '42501', null, 'owner cannot create another tenant link'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select results_eq($$ select id from public.conversation_link $$, $$ select null::uuid where false $$, 'artist cannot read links');
select throws_ok(
  $$ insert into public.conversation_link (studio_id, provider, external_account_id, external_inbox_id, external_conversation_id, customer_id) values ('20000000-0000-0000-0000-000000000001', 'chatwoot', '3', '7', '44', '60000000-0000-0000-0000-000000000011') $$,
  '42501', null, 'artist cannot create links'
);

reset role;
set local role anon;
select throws_ok($$ select * from public.conversation_link $$, '42501', null, 'anon cannot read links');

reset role;
set local role service_role;
select is(
  public.ingest_conversation_webhook('20000000-0000-0000-0000-000000000001', 'chatwoot', 'delivery-1', 'message_created', '3', '7', '42', '84', '2026-09-14T10:00:00Z'),
  'ACCEPTED', 'first authentic delivery is accepted'
);
select is(
  public.ingest_conversation_webhook('20000000-0000-0000-0000-000000000001', 'chatwoot', 'delivery-1', 'message_created', '3', '7', '42', '85', '2026-09-14T11:00:00Z'),
  'DUPLICATE', 'repeated delivery converges as duplicate'
);
select is((select count(*) from public.conversation_webhook_receipt where delivery_id = 'delivery-1'), 1::bigint, 'one receipt persists per delivery');
select results_eq(
  $$ select last_external_message_id, last_activity_at from public.conversation_link where id = '80000000-0000-0000-0000-000000000011' $$,
  $$ values ('84'::text, '2026-09-14T10:00:00Z'::timestamptz) $$,
  'duplicate does not update the linked conversation twice'
);
select is(
  public.ingest_conversation_webhook('20000000-0000-0000-0000-000000000001', 'chatwoot', 'delivery-old', 'message_created', '3', '7', '42', '83', '2026-09-14T09:00:00Z'),
  'ACCEPTED', 'an out-of-order authentic delivery is recorded'
);
select results_eq(
  $$ select last_external_message_id, last_activity_at from public.conversation_link where id = '80000000-0000-0000-0000-000000000011' $$,
  $$ values ('84'::text, '2026-09-14T10:00:00Z'::timestamptz) $$,
  'an older delivery cannot move linked activity backwards'
);
select throws_ok(
  $$ insert into public.conversation_webhook_receipt (studio_id, provider, delivery_id, event_name, external_account_id, external_inbox_id, external_conversation_id, external_message_id, occurred_at) values ('20000000-0000-0000-0000-000000000001', 'chatwoot', 'delivery-1', 'message_created', '3', '7', '42', '84', now()) $$,
  '23505', null, 'delivery uniqueness rejects direct duplicates'
);

select * from finish();
rollback;
