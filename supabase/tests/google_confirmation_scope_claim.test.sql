begin;
select plan(22);

set local role service_role;
select lives_ok($setup$
 insert into public.customer(id,studio_id,name,status) values('60000000-0000-0000-0000-000000000041','20000000-0000-0000-0000-000000000001','Scope claim client','ACTIVE');
 insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values('70000000-0000-0000-0000-000000000041','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000041','Scope claim case','50000000-0000-0000-0000-000000000001','OPEN');
 select public.activate_google_calendar_connection(
   '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'v1.scope-claim-ciphertext.tag',
   array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']);
 select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','scope-claim@example.test','writer');
 create temporary table scope_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000041','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-22T09:00:00.000Z","endUtc":"2026-09-22T10:00:00.000Z"}]','2026-09-15T10:00:00Z')->>'id')::uuid offer_id;
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from scope_offer),repeat('57',32),'2026-09-15T10:01:00Z');
 create temporary table scope_selector as select public.get_public_booking_offer(repeat('57',32),'2026-09-15T10:02:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('57',32),(select selector from scope_selector),'2026-09-15T10:03:00Z');
$setup$,'active writer fixture starts without the FreeBusy scope');

select is(
 public.claim_public_booking_confirmation(repeat('57',32),'inkendarscopeclaim001',repeat('S',43),'2026-09-15T10:04:00Z')->>'kind',
 'RECONNECT_REQUIRED',
 'calendarlist plus Events without FreeBusy requires reconnect');
reset role;
select is((select count(*) from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),0::bigint,'missing FreeBusy creates no operation, lease, or binding');
delete from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer);

set local role service_role;
select lives_ok($$select public.activate_google_calendar_connection(
 '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v2.scope-claim-ciphertext.tag',
 array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy'])$$,'fixture can reconnect without Events scope');
select is(
 public.claim_public_booking_confirmation(repeat('57',32),'inkendarscopeclaim001',repeat('S',43),'2026-09-15T10:04:30Z')->>'kind',
 'RECONNECT_REQUIRED',
 'calendarlist plus FreeBusy without Events requires reconnect');
reset role;
select is((select count(*) from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),0::bigint,'missing Events creates no operation, lease, or binding');

set local role service_role;
select lives_ok($$select public.activate_google_calendar_connection(
 '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v3.scope-claim-ciphertext.tag',
 array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events'])$$,'fixture can reconnect with both operational scopes');
select lives_ok($$create temporary table full_scope_claim as select public.claim_public_booking_confirmation(repeat('57',32),'inkendarscopeclaim001',repeat('S',43),'2026-09-15T10:05:00Z') value$$,'complete grant can establish the durable operation');
select is((select value->>'kind' from full_scope_claim),'CLAIMED','complete operational grant is claimed');
reset role;
select is((select count(*) from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),1::bigint,'complete grant creates one durable operation');
create temporary table scope_operation_before as
select state,lease_id,lease_expires_at,updated_at,
 jsonb_build_object(
   'booking_offer_id',booking_offer_id,'studio_id',studio_id,'artist_profile_id',artist_profile_id,
   'booking_option_id',booking_option_id,'connection_id',connection_id,'calendar_id',calendar_id,
   'event_id',event_id,'correlation',correlation) binding
from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer);

set local role service_role;
select lives_ok($$select public.activate_google_calendar_connection(
 '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v4.scope-claim-ciphertext.tag',
 array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events'])$$,'existing operation can observe a grant that lost FreeBusy');
select lives_ok($$create temporary table missing_freebusy_retry as select public.claim_public_booking_confirmation(repeat('57',32),'inkendarscopeclaim001',repeat('S',43),'2026-09-15T10:08:00Z') value$$,'retry with missing FreeBusy returns safely');
select is((select value->>'kind' from missing_freebusy_retry),'RECONNECT_REQUIRED','existing operation missing FreeBusy requires reconnect');
reset role;
select is((select state from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),(select state from scope_operation_before),'missing FreeBusy preserves READY state');
select is((select lease_id from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),(select lease_id from scope_operation_before),'missing FreeBusy does not renew the lease id');
select is((select lease_expires_at from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),(select lease_expires_at from scope_operation_before),'missing FreeBusy does not renew lease expiry');
select is((select updated_at from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),(select updated_at from scope_operation_before),'missing FreeBusy does not touch operation time');
select is((select jsonb_build_object(
 'booking_offer_id',booking_offer_id,'studio_id',studio_id,'artist_profile_id',artist_profile_id,
 'booking_option_id',booking_option_id,'connection_id',connection_id,'calendar_id',calendar_id,
 'event_id',event_id,'correlation',correlation)
 from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),(select binding from scope_operation_before),'missing FreeBusy preserves the immutable binding');

set local role service_role;
select lives_ok($$select public.activate_google_calendar_connection(
 '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v5.scope-claim-ciphertext.tag',
 array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy'])$$,'existing operation can observe a grant that lost Events');
select lives_ok($$create temporary table missing_events_retry as select public.claim_public_booking_confirmation(repeat('57',32),'inkendarscopeclaim001',repeat('S',43),'2026-09-15T10:11:00Z') value$$,'retry with missing Events returns safely');
select is((select value->>'kind' from missing_events_retry),'RECONNECT_REQUIRED','existing operation missing Events requires reconnect');
reset role;
select is((select jsonb_build_object('state',state,'lease_id',lease_id,'lease_expires_at',lease_expires_at,'updated_at',updated_at,
 'booking_offer_id',booking_offer_id,'studio_id',studio_id,'artist_profile_id',artist_profile_id,'booking_option_id',booking_option_id,
 'connection_id',connection_id,'calendar_id',calendar_id,'event_id',event_id,'correlation',correlation)
 from public.booking_confirmation_operation where booking_offer_id=(select offer_id from scope_offer)),
 (select binding || jsonb_build_object('state',state,'lease_id',lease_id,'lease_expires_at',lease_expires_at,'updated_at',updated_at) from scope_operation_before),
 'missing Events also preserves state, lease, and binding');

select * from finish();
rollback;
