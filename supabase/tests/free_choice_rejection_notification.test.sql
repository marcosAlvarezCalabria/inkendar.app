begin;

select plan(38);

select enum_has_labels('public','booking_notification_event_type',array['CONFIRMED','EXPIRED','REJECTED'],'notification events include free-choice rejection only once');
select has_column('public','booking_notification_job','free_choice_request_id','outbox can reference a free-choice request');
select hasnt_column('public','booking_notification_job','content','rejection content is never persisted');
select hasnt_column('public','booking_notification_job','recipient','rejection recipient is never persisted');
select ok((select relrowsecurity from pg_class where oid='public.booking_notification_job'::regclass),'rejection jobs retain RLS');
select ok(not has_table_privilege('service_role','public.booking_notification_job','select'),'service role still uses guarded RPCs');
select ok(has_function_privilege('service_role','public.claim_booking_notification_job(timestamptz,timestamptz)','execute'),'service role may claim rejection jobs');
select ok(not has_function_privilege('authenticated','public.claim_booking_notification_job(timestamptz,timestamptz)','execute'),'browser cannot claim rejection jobs');
select has_trigger('public','free_choice_pending_request','free_choice_request_enqueue_rejection_notification','rejection transition has a transactional outbox trigger');
select is((select proconfig from pg_proc where oid='private.enqueue_free_choice_rejection_notification()'::regprocedure),array['search_path=""'],'rejection trigger fixes empty search path');

insert into public.customer(id,studio_id,name,email,status) values
('60000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000001','Rejected route client','rejected-route@example.test','ACTIVE'),
('60000000-0000-0000-0000-000000000087','20000000-0000-0000-0000-000000000001','Rejected email client','rejected-email@example.test','ACTIVE'),
('60000000-0000-0000-0000-000000000088','20000000-0000-0000-0000-000000000001','Rejected no route client',null,'ACTIVE'),
('60000000-0000-0000-0000-000000000089','20000000-0000-0000-0000-000000000001','Rejected ambiguous client','ambiguous@example.test','ACTIVE');

insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values
('70000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000086','Rejected route case','50000000-0000-0000-0000-000000000001','OPEN'),
('70000000-0000-0000-0000-000000000087','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000087','Rejected email case','50000000-0000-0000-0000-000000000001','OPEN'),
('70000000-0000-0000-0000-000000000088','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000088','Rejected no route case','50000000-0000-0000-0000-000000000001','OPEN'),
('70000000-0000-0000-0000-000000000089','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000089','Rejected ambiguous case','50000000-0000-0000-0000-000000000001','OPEN');

insert into public.free_choice_availability_access(id,studio_id,tattoo_case_id,artist_profile_id,token_hash,range_start,range_end,duration_minutes,expires_at,issued_at,updated_at) values
('85000000-0000-4000-8000-000000000086','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000086','50000000-0000-0000-0000-000000000001',decode(repeat('86',32),'hex'),'2026-09-21T00:00:00Z','2026-09-22T00:00:00Z',60,'2026-09-21T12:00:00Z','2026-09-20T08:00:00Z','2026-09-20T08:00:00Z'),
('85000000-0000-4000-8000-000000000087','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000087','50000000-0000-0000-0000-000000000001',decode(repeat('87',32),'hex'),'2026-09-22T00:00:00Z','2026-09-23T00:00:00Z',60,'2026-09-22T12:00:00Z','2026-09-20T08:00:00Z','2026-09-20T08:00:00Z'),
('85000000-0000-4000-8000-000000000088','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000088','50000000-0000-0000-0000-000000000001',decode(repeat('88',32),'hex'),'2026-09-23T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z','2026-09-20T08:00:00Z'),
('85000000-0000-4000-8000-000000000089','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000089','50000000-0000-0000-0000-000000000001',decode(repeat('89',32),'hex'),'2026-09-24T00:00:00Z','2026-09-25T00:00:00Z',60,'2026-09-24T12:00:00Z','2026-09-20T08:00:00Z','2026-09-20T08:00:00Z');

insert into public.free_choice_pending_request(id,access_id,studio_id,tattoo_case_id,artist_profile_id,selector_hash,start_at,end_at,expires_at,status,created_at) values
('86000000-0000-4000-8000-000000000086','85000000-0000-4000-8000-000000000086','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000086','50000000-0000-0000-0000-000000000001',decode(repeat('96',32),'hex'),'2026-09-21T09:00:00Z','2026-09-21T10:00:00Z','2026-09-21T08:00:00Z','PENDING_OWNER_APPROVAL','2026-09-20T09:00:00Z'),
('86000000-0000-4000-8000-000000000087','85000000-0000-4000-8000-000000000087','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000087','50000000-0000-0000-0000-000000000001',decode(repeat('97',32),'hex'),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-22T08:00:00Z','PENDING_OWNER_APPROVAL','2026-09-20T09:00:00Z'),
('86000000-0000-4000-8000-000000000088','85000000-0000-4000-8000-000000000088','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000088','50000000-0000-0000-0000-000000000001',decode(repeat('98',32),'hex'),'2026-09-23T09:00:00Z','2026-09-23T10:00:00Z','2026-09-23T08:00:00Z','PENDING_OWNER_APPROVAL','2026-09-20T09:00:00Z'),
('86000000-0000-4000-8000-000000000089','85000000-0000-4000-8000-000000000089','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000089','50000000-0000-0000-0000-000000000001',decode(repeat('99',32),'hex'),'2026-09-24T09:00:00Z','2026-09-24T10:00:00Z','2026-09-24T08:00:00Z','PENDING_OWNER_APPROVAL','2026-09-20T09:00:00Z');

insert into public.conversation_link(id,studio_id,provider,external_account_id,external_inbox_id,external_conversation_id,customer_id,tattoo_case_id) values
('87000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000001','chatwoot','3','7','86','60000000-0000-0000-0000-000000000086','70000000-0000-0000-0000-000000000086'),
('87000000-0000-0000-0000-000000000087','20000000-0000-0000-0000-000000000001','chatwoot','3','7','87','60000000-0000-0000-0000-000000000087','70000000-0000-0000-0000-000000000087'),
('87000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000001','chatwoot','3','7','97','60000000-0000-0000-0000-000000000087','70000000-0000-0000-0000-000000000087'),
('87000000-0000-0000-0000-000000000089','20000000-0000-0000-0000-000000000001','chatwoot','3','7','89','60000000-0000-0000-0000-000000000089','70000000-0000-0000-0000-000000000089');

set local role service_role;
select is(public.reject_free_choice_owner_request('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-4000-8000-000000000086','2026-09-20T09:01:00Z')->>'state','REJECTED','OWNER rejection remains durable');
reset role;
select is((select status::text from public.free_choice_pending_request where id='86000000-0000-4000-8000-000000000086'),'REJECTED','request is rejected');
select is((select count(*) from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000086'),1::bigint,'first rejection materializes one job');
select is((select event_type::text from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000086'),'REJECTED','job records only the rejection event');
select is((select booking_offer_id from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000086'),null::uuid,'rejection job has no booking-offer source');
set local role service_role;
select is(public.reject_free_choice_owner_request('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-4000-8000-000000000086','2026-09-20T09:02:00Z')->>'state','REJECTED','rejection retry remains idempotent');
reset role;
select is((select count(*) from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000086'),1::bigint,'rejection retry creates no second job');
select throws_ok($$insert into public.booking_notification_job(studio_id,free_choice_request_id,event_type,next_attempt_at,created_at,updated_at) values('20000000-0000-0000-0000-000000000002','86000000-0000-4000-8000-000000000086','REJECTED','2026-09-20T09:02:00Z','2026-09-20T09:02:00Z','2026-09-20T09:02:00Z')$$,'23503',null,'cross-tenant request cannot become a routeable job');

set local role service_role;
create temporary table rejected_chatwoot_claim as select * from public.claim_booking_notification_job(transaction_timestamp(),transaction_timestamp()+interval '30 seconds');
select is((select claim_status from rejected_chatwoot_claim),'CLAIMED','rejection job obtains a bounded lease');
select is((select event_type from rejected_chatwoot_claim),'REJECTED','claim preserves rejection event');
select is((select delivery_channel from rejected_chatwoot_claim),'CHATWOOT','one same-tenant Chatwoot route is preferred');
select is((select customer_email from rejected_chatwoot_claim),null,'preferred Chatwoot claim does not expose fallback email');
select lives_ok($$select public.transition_booking_notification_job((select job_id from rejected_chatwoot_claim),(select lease_id from rejected_chatwoot_claim),'FAILED',null,transaction_timestamp()+interval '1 minute',transaction_timestamp()+interval '1 second')$$,'confirmed rejection remains retryable');
select is((select count(*) from public.claim_booking_notification_job(transaction_timestamp()+interval '59 seconds',transaction_timestamp()+interval '89 seconds')),0::bigint,'rejection backoff prevents early retry');
create temporary table rejected_retry_claim as select * from public.claim_booking_notification_job(transaction_timestamp()+interval '1 minute',transaction_timestamp()+interval '90 seconds');
select is((select attempt_count from rejected_retry_claim),2,'rejection retry increments the bounded count');
select lives_ok($$select public.transition_booking_notification_job((select job_id from rejected_retry_claim),(select lease_id from rejected_retry_claim),'SUCCEEDED','86',null,transaction_timestamp()+interval '61 seconds')$$,'confirmed rejection delivery converges to success');
reset role;
select is((select status::text from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000086'),'SUCCEEDED','rejection success is durable');

set local role service_role;
select lives_ok($$select public.reject_free_choice_owner_request('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-4000-8000-000000000087','2026-09-20T09:04:00Z')$$,'email-route rejection materializes');
create temporary table rejected_email_claim as select * from public.claim_booking_notification_job(transaction_timestamp()+interval '2 minutes',transaction_timestamp()+interval '150 seconds');
select is((select delivery_channel from rejected_email_claim),'EMAIL','ambiguous Chatwoot rejection falls back to email');
select is((select customer_email from rejected_email_claim),'rejected-email@example.test','fallback email comes from the same-tenant customer only');
select is((select external_conversation_id from rejected_email_claim),null,'email fallback selects no ambiguous conversation');
select lives_ok($$select public.transition_booking_notification_job((select job_id from rejected_email_claim),(select lease_id from rejected_email_claim),'SUCCEEDED','smtp_rejectedopaqueid',null,transaction_timestamp()+interval '121 seconds')$$,'email-route rejection converges to success');

select lives_ok($$select public.reject_free_choice_owner_request('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-4000-8000-000000000088','2026-09-20T09:05:00Z')$$,'no-route rejection materializes');
select is((select claim_status from public.claim_booking_notification_job(transaction_timestamp()+interval '3 minutes',transaction_timestamp()+interval '210 seconds')),'NO_ROUTE','rejection without conversation or email becomes no-route');
reset role;
select is((select status::text from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000088'),'NO_ROUTE','rejection no-route is terminal');

set local role service_role;
select lives_ok($$select public.reject_free_choice_owner_request('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-4000-8000-000000000089','2026-09-20T09:06:00Z')$$,'ambiguous-route rejection materializes');
create temporary table rejected_ambiguous_claim as select * from public.claim_booking_notification_job(transaction_timestamp()+interval '4 minutes',transaction_timestamp()+interval '270 seconds');
select is((select claim_status from public.claim_booking_notification_job(transaction_timestamp()+interval '271 seconds',transaction_timestamp()+interval '301 seconds')),'UNKNOWN','expired rejection lease becomes unknown without resend');
reset role;
select is((select status::text from public.booking_notification_job where free_choice_request_id='86000000-0000-4000-8000-000000000089'),'UNKNOWN','ambiguous rejection is terminal and explicit');

select * from finish();
rollback;
