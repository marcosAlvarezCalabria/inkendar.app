begin;

select plan(41);

select has_type('public','booking_notification_event_type','notification event type exists');
select enum_has_labels('public','booking_notification_event_type',array['CONFIRMED','EXPIRED'],'only supported booking events are materialized');
select has_type('public','booking_notification_status','notification status exists');
select enum_has_labels('public','booking_notification_status',array['PENDING','LEASED','SUCCEEDED','FAILED','UNKNOWN','NO_ROUTE'],'conservative states are explicit');
select has_table('public','booking_notification_job','durable notification jobs exist');
select hasnt_column('public','booking_notification_job','content','message text is never persisted');
select hasnt_column('public','booking_notification_job','payload','provider payload is never persisted');
select ok((select relrowsecurity from pg_class where oid='public.booking_notification_job'::regclass),'notification RLS enabled');
select ok(not has_table_privilege('service_role','public.booking_notification_job','select'),'service role uses guarded RPCs');
select ok(not has_table_privilege('authenticated','public.booking_notification_job','select'),'browser cannot read jobs');
select ok(has_function_privilege('service_role','public.materialize_due_booking_expirations(timestamptz,integer)','execute'),'service role may materialize expirations');
select ok(has_function_privilege('service_role','public.claim_booking_notification_job(timestamptz,timestamptz)','execute'),'service role may claim');
select ok(has_function_privilege('service_role','public.transition_booking_notification_job(uuid,uuid,booking_notification_status,text,timestamptz,timestamptz)','execute'),'service role may transition');
select ok(not has_function_privilege('authenticated','public.claim_booking_notification_job(timestamptz,timestamptz)','execute'),'authenticated cannot claim');
select is((select proconfig from pg_proc where oid='public.claim_booking_notification_job(timestamptz,timestamptz)'::regprocedure),array['search_path=""'],'claim fixes empty search path');
select is((select count(*) from pg_constraint where conrelid='public.booking_notification_job'::regclass and contype='u' and pg_get_constraintdef(oid) ilike '%booking_offer_id%event_type%'),1::bigint,'one job exists per offer event');

insert into public.customer(id,studio_id,name,status) values
('60000000-0000-0000-0000-000000000080','20000000-0000-0000-0000-000000000001','Notification client','ACTIVE');
insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values
('70000000-0000-0000-0000-000000000080','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000080','Synthetic notification case','50000000-0000-0000-0000-000000000001','OPEN');
insert into public.conversation_link(id,studio_id,provider,external_account_id,external_inbox_id,external_conversation_id,customer_id,tattoo_case_id) values
('80000000-0000-0000-0000-000000000080','20000000-0000-0000-0000-000000000001','chatwoot','3','7','42','60000000-0000-0000-0000-000000000080','70000000-0000-0000-0000-000000000080');

create temporary table expired_offer as
select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000080','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-20T09:00:00.000Z","endUtc":"2026-09-20T10:00:00.000Z"}]','2026-09-15T10:00:00Z')->>'id')::uuid id;

set local role service_role;
select is(public.materialize_due_booking_expirations('2026-09-17T10:00:00Z',10),1,'scheduler expires one due OPEN offer');
select is(public.materialize_due_booking_expirations('2026-09-17T10:00:00Z',10),0,'expiry materialization is idempotent');
reset role;
select is((select status::text from public.booking_offer where id=(select id from expired_offer)),'EXPIRED','due offer becomes expired');
select is((select status::text from public.booking_option where offer_id=(select id from expired_offer)),'RELEASED','due option is released');
select is((select count(*) from public.booking_notification_job where booking_offer_id=(select id from expired_offer) and event_type='EXPIRED'),1::bigint,'expiry materializes one durable intent');
update public.booking_offer set status='EXPIRED' where id=(select id from expired_offer);
select is((select count(*) from public.booking_notification_job where booking_offer_id=(select id from expired_offer) and event_type='EXPIRED'),1::bigint,'repeated state does not duplicate intent');

set local role service_role;
create temporary table first_claim as select * from public.claim_booking_notification_job('2026-09-17T10:00:01Z','2026-09-17T10:00:31Z');
select is((select claim_status from first_claim),'CLAIMED','one worker claims the routed job');
select is((select external_account_id from first_claim),'3','claim keeps the linked account');
select is((select external_conversation_id from first_claim),'42','claim keeps the linked original conversation');
select lives_ok($$select public.transition_booking_notification_job((select job_id from first_claim),(select lease_id from first_claim),'FAILED',null,'2026-09-17T10:01:01Z','2026-09-17T10:00:02Z')$$,'confirmed failure becomes retryable');
select is((select count(*) from public.claim_booking_notification_job('2026-09-17T10:00:30Z','2026-09-17T10:01:00Z')),0::bigint,'backoff prevents early retry');
create temporary table retry_claim as select * from public.claim_booking_notification_job('2026-09-17T10:01:01Z','2026-09-17T10:01:31Z');
select is((select attempt_count from retry_claim),2,'retry increments the bounded attempt count');
select lives_ok($$select public.transition_booking_notification_job((select job_id from retry_claim),(select lease_id from retry_claim),'SUCCEEDED','84',null,'2026-09-17T10:01:02Z')$$,'confirmed provider result converges to success');
reset role;
select is((select status::text from public.booking_notification_job where booking_offer_id=(select id from expired_offer)),'SUCCEEDED','success is persisted');
set local role service_role;
select is((select count(*) from public.claim_booking_notification_job('2026-09-17T10:02:00Z','2026-09-17T10:02:30Z')),0::bigint,'succeeded work is never reclaimed');
reset role;

create temporary table no_route_offer as
select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000080','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-21T09:00:00.000Z","endUtc":"2026-09-21T10:00:00.000Z"}]','2026-09-17T10:00:00Z')->>'id')::uuid id;
insert into public.conversation_link(id,studio_id,provider,external_account_id,external_inbox_id,external_conversation_id,customer_id,tattoo_case_id) values
('80000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000001','chatwoot','3','7','43','60000000-0000-0000-0000-000000000080','70000000-0000-0000-0000-000000000080');
update public.booking_offer set status='CONFIRMED' where id=(select id from no_route_offer);
set local role service_role;
select is((select claim_status from public.claim_booking_notification_job('2026-09-17T10:02:00Z','2026-09-17T10:02:30Z')),'NO_ROUTE','zero or multiple original conversations become explicit no-route');
reset role;
select is((select status::text from public.booking_notification_job where booking_offer_id=(select id from no_route_offer)),'NO_ROUTE','no-route is terminal without claiming delivery');
select is((select event_type::text from public.booking_notification_job where booking_offer_id=(select id from no_route_offer)),'CONFIRMED','confirmation materializes its distinct durable event');

delete from public.conversation_link where id='80000000-0000-0000-0000-000000000081';
create temporary table ambiguous_offer as
select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000080','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-22T09:00:00.000Z","endUtc":"2026-09-22T10:00:00.000Z"}]','2026-09-17T10:00:00Z')->>'id')::uuid id;
update public.booking_offer set status='EXPIRED',updated_at='2026-09-17T10:03:00Z' where id=(select id from ambiguous_offer);
set local role service_role;
create temporary table ambiguous_claim as select * from public.claim_booking_notification_job('2026-09-17T10:03:00Z','2026-09-17T10:03:30Z');
select is((select claim_status from ambiguous_claim),'CLAIMED','routed work obtains a bounded lease');
select is((select claim_status from public.claim_booking_notification_job('2026-09-17T10:03:31Z','2026-09-17T10:04:01Z')),'UNKNOWN','an expired lease becomes ambiguous instead of being resent');
reset role;
select is((select status::text from public.booking_notification_job where booking_offer_id=(select id from ambiguous_offer)),'UNKNOWN','ambiguous lease is terminal and explicit');

set local role service_role;
select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v1.scheduler-ciphertext.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events']);
reset role;
create temporary table inserting_offer as
select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000080','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-23T09:00:00.000Z","endUtc":"2026-09-23T10:00:00.000Z"}]','2026-09-17T10:00:00Z')->>'id')::uuid id;
update public.booking_offer set status='SELECTED_PENDING_CONFIRMATION' where id=(select id from inserting_offer);
update public.booking_option set status='SELECTED' where offer_id=(select id from inserting_offer);
insert into public.booking_confirmation_operation(booking_offer_id,studio_id,artist_profile_id,booking_option_id,connection_id,calendar_id,event_id,correlation,state,created_at,updated_at)
select offer.id,offer.studio_id,offer.artist_profile_id,option.id,connection.id,'artist-a@example.test','inkendar0123456789scheduler',repeat('S',43),'INSERTING','2026-09-17T10:01:00Z','2026-09-17T10:01:00Z'
from public.booking_offer offer join public.booking_option option on option.offer_id=offer.id
join public.google_calendar_connection connection on connection.studio_id=offer.studio_id
where offer.id=(select id from inserting_offer);
set local role service_role;
select is(public.materialize_due_booking_expirations('2026-09-19T10:00:00Z',10),0,'scheduler never releases an INSERTING selection');
reset role;
select is((select status::text from public.booking_offer where id=(select id from inserting_offer)),'SELECTED_PENDING_CONFIRMATION','INSERTING offer remains recoverable');
select is((select status::text from public.booking_option where offer_id=(select id from inserting_offer)),'SELECTED','INSERTING option remains selected');
select is((select count(*) from public.booking_notification_job where booking_offer_id=(select id from inserting_offer) and event_type='EXPIRED'),0::bigint,'no false expiry notification is materialized for INSERTING');

select * from finish();
rollback;
