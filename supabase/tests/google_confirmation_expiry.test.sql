begin;
select plan(29);

select ok(
  (
    select pg_get_functiondef(oid) ilike '%for update of offer%'
    from pg_proc
    where oid = 'public.begin_public_booking_confirmation_insert(text, uuid, timestamptz)'::regprocedure
  ),
  'begin insert serializes with expiry by locking the offer first'
);

set local role service_role;
select lives_ok($setup$
 insert into public.customer(id,studio_id,name,status) values('60000000-0000-0000-0000-000000000050','20000000-0000-0000-0000-000000000001','Expiry client','ACTIVE');
 insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values('70000000-0000-0000-0000-000000000050','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000050','Expiry case','50000000-0000-0000-0000-000000000001','OPEN');
 select public.save_booking_offer_expiry_hours('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1);
 select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v1.expiry-ciphertext.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events']);
 select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','artist-a@example.test','writer');
 create temporary table ready_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000050','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-24T09:00:00.000Z","endUtc":"2026-09-24T10:00:00.000Z"}]','2026-09-15T08:00:00Z')->>'id')::uuid offer_id;
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from ready_offer),repeat('66',32),'2026-09-15T08:00:30Z');
 create temporary table ready_selector as select public.get_public_booking_offer(repeat('66',32),'2026-09-15T08:01:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('66',32),(select selector from ready_selector),'2026-09-15T08:01:30Z');
 create temporary table ready_claim as select public.claim_public_booking_confirmation(repeat('66',32),'inkendar0123456789aaa',repeat('R',43),'2026-09-15T08:02:00Z') value;
$setup$,'READY fixture is selected and claimed');
select is((select value->>'mode' from ready_claim),'INSERT_OR_RECONCILE','READY fixture initially allows a fenced insert');
select is(public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15T09:01:00Z'),1,'READY offer expires after its deadline');
reset role;
select is((select status::text from public.booking_offer where id=(select offer_id from ready_offer)),'EXPIRED','READY offer becomes expired');
select is((select status::text from public.booking_option where offer_id=(select offer_id from ready_offer)),'RELEASED','READY selected option is released');
set local role service_role;
select is(public.begin_public_booking_confirmation_insert(repeat('66',32),(select (value->>'lease_id')::uuid from ready_claim),'2026-09-15T09:01:01Z'),false,'expired READY lease cannot begin insert');
select is(public.get_public_booking_offer(repeat('66',32),'2026-09-15T09:01:01Z'),null::jsonb,'expired READY offer is no longer public');
select is(public.get_public_booking_confirmation_context(repeat('66',32),'2026-09-15T09:01:01Z'),null::jsonb,'expired READY offer has no confirmation context');
select is(public.claim_public_booking_confirmation(repeat('66',32),'inkendar0123456789aaa',repeat('R',43),'2026-09-15T09:01:01Z'),null::jsonb,'expired READY offer cannot be reclaimed');

select lives_ok($setup$
 create temporary table inserting_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000050','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-25T09:00:00.000Z","endUtc":"2026-09-25T10:00:00.000Z"}]','2026-09-15T10:00:00Z')->>'id')::uuid offer_id;
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from inserting_offer),repeat('77',32),'2026-09-15T10:00:30Z');
 create temporary table inserting_selector as select public.get_public_booking_offer(repeat('77',32),'2026-09-15T10:01:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('77',32),(select selector from inserting_selector),'2026-09-15T10:01:30Z');
 create temporary table inserting_claim as select public.claim_public_booking_confirmation(repeat('77',32),'inkendar0123456789bbb',repeat('I',43),'2026-09-15T10:59:30Z') value;
$setup$,'INSERTING fixture is selected and claimed near expiry');
select is(public.begin_public_booking_confirmation_insert(repeat('77',32),(select (value->>'lease_id')::uuid from inserting_claim),'2026-09-15T10:59:31Z'),true,'fixture crosses the irreversible insert fence');
select is(public.claim_public_booking_confirmation(repeat('77',32),'inkendar0123456789bbb',repeat('I',43),'2026-09-15T11:00:30Z')->>'kind','BUSY','expired offer with a live INSERTING lease stays busy');
select is(public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15T11:00:30Z'),0,'expiry skips INSERTING offer');
reset role;
select is((select status::text from public.booking_offer where id=(select offer_id from inserting_offer)),'SELECTED_PENDING_CONFIRMATION','INSERTING offer remains pending after deadline');
select is((select status::text from public.booking_option where offer_id=(select offer_id from inserting_offer)),'SELECTED','INSERTING option remains selected after deadline');
set local role service_role;
select is(public.get_public_booking_offer(repeat('77',32),'2026-09-15T11:00:30Z')->>'state','SELECTION_PENDING_CONFIRMATION','public retry view survives expiry while INSERTING');
select is(public.select_public_booking_offer(repeat('77',32),(select selector from inserting_selector),'2026-09-15T11:00:30Z')->>'state','SELECTION_PENDING_CONFIRMATION','winning selector remains idempotent after expiry');
select is(public.get_public_booking_confirmation_context(repeat('77',32),'2026-09-15T11:00:30Z')->>'state','PENDING','confirmation context survives expiry while INSERTING');
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-25T00:00:00Z','2026-09-26T00:00:00Z','2026-09-15T11:00:30Z')),1::bigint,'INSERTING interval remains excluded after offer expiry');
select throws_ok($$select public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000050','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-25T09:30:00.000Z","endUtc":"2026-09-25T10:30:00.000Z"}]','2026-09-15T11:00:30Z')$$,'23P01',null,'new offer cannot overlap expired INSERTING interval');
select lives_ok($$create temporary table inserting_recovery as select public.claim_public_booking_confirmation(repeat('77',32),'inkendar0123456789bbb',repeat('I',43),'2026-09-15T11:02:00Z') value$$,'expired INSERTING lease can be reclaimed after offer expiry');
select is((select value->>'mode' from inserting_recovery),'RECONCILE_ONLY','post-expiry recovery is reconciliation-only');
select is((select value->>'calendar_id' from inserting_recovery),'artist-a@example.test','post-expiry recovery preserves calendar A');
select is(public.begin_public_booking_confirmation_insert(repeat('77',32),(select (value->>'lease_id')::uuid from inserting_recovery),'2026-09-15T11:02:01Z'),false,'post-expiry recovery cannot reacquire insert authority');
select is(public.finalize_public_booking_confirmation(repeat('77',32),(select (value->>'lease_id')::uuid from inserting_recovery),(select id from public.get_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')),'artist-a@example.test','inkendar0123456789bbb',repeat('I',43),'2026-09-15T11:02:02Z')->>'confirmed_at','2026-09-15T11:02:02+00:00','matching event can finalize after original expiry');
reset role;
select is((select status::text from public.booking_offer where id=(select offer_id from inserting_offer)),'CONFIRMED','post-expiry reconciliation confirms offer');
select is((select status::text from public.booking_option where offer_id=(select offer_id from inserting_offer)),'CONFIRMED','post-expiry reconciliation confirms option');
set local role service_role;
select is(public.get_public_booking_offer(repeat('77',32),'2026-09-16T12:00:00Z')->>'state','CONFIRMED','confirmed view remains available');

select * from finish();
rollback;
