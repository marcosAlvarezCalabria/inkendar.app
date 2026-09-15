begin;
select plan(14);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz)'::regprocedure)) > 0
    and position('private.materialize_expired_booking_offers' in pg_get_functiondef('public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz)'::regprocedure))
      > position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_booking_offer(uuid,uuid,uuid,uuid,jsonb,timestamptz)'::regprocedure)),
  'create retains the artist advisory lock before materializing expired offers'
);

set local role service_role;
select lives_ok($setup$
 insert into public.customer(id,studio_id,name,status) values('60000000-0000-0000-0000-000000000060','20000000-0000-0000-0000-000000000001','Create race client','ACTIVE');
 insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values('70000000-0000-0000-0000-000000000060','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000060','Create race case','50000000-0000-0000-0000-000000000001','OPEN');
 select public.save_booking_offer_expiry_hours('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1);
 select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v1.create-race-ciphertext.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events']);
 select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','artist-a@example.test','writer');
 create temporary table create_wins_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000060','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-26T09:00:00.000Z","endUtc":"2026-09-26T10:00:00.000Z"}]','2026-09-15T08:00:00Z')->>'id')::uuid offer_id;
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from create_wins_offer),repeat('88',32),'2026-09-15T08:00:30Z');
 create temporary table create_wins_selector as select public.get_public_booking_offer(repeat('88',32),'2026-09-15T08:01:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('88',32),(select selector from create_wins_selector),'2026-09-15T08:01:30Z');
 create temporary table create_wins_claim as select public.claim_public_booking_confirmation(repeat('88',32),'inkendar0123456789ccc',repeat('W',43),'2026-09-15T08:59:00Z') value;
$setup$,'create-wins fixture has a READY selection near expiry');

select lives_ok($create$
 create temporary table replacement_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000060','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-26T09:30:00.000Z","endUtc":"2026-09-26T10:30:00.000Z"}]','2026-09-15T09:01:00Z')->>'id')::uuid offer_id;
$create$,'create materializes an expired READY selection before reusing its interval');
reset role;
select is((select status::text from public.booking_offer where id=(select offer_id from create_wins_offer)),'EXPIRED','create-wins makes the prior offer durably EXPIRED');
select is((select status::text from public.booking_option where offer_id=(select offer_id from create_wins_offer)),'RELEASED','create-wins releases the prior selected option');
set local role service_role;
select is(public.begin_public_booking_confirmation_insert(repeat('88',32),(select (value->>'lease_id')::uuid from create_wins_claim),'2026-09-15T08:59:30Z'),false,'a delayed begin with stale p_now cannot cross the fence after create wins');
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-26T00:00:00Z','2026-09-27T00:00:00Z','2026-09-15T09:01:01Z')),1::bigint,'only the replacement interval remains held after materialization');

select lives_ok($setup$
 create temporary table begin_wins_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000060','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-27T09:00:00.000Z","endUtc":"2026-09-27T10:00:00.000Z"}]','2026-09-15T10:00:00Z')->>'id')::uuid offer_id;
 select public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15T10:30:00Z');
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from begin_wins_offer),repeat('99',32),'2026-09-15T10:00:30Z');
 create temporary table begin_wins_selector as select public.get_public_booking_offer(repeat('99',32),'2026-09-15T10:01:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('99',32),(select selector from begin_wins_selector),'2026-09-15T10:01:30Z');
 create temporary table begin_wins_claim as select public.claim_public_booking_confirmation(repeat('99',32),'inkendar0123456789ddd',repeat('B',43),'2026-09-15T10:59:00Z') value;
$setup$,'begin-wins fixture has a READY selection near expiry');
select is(public.begin_public_booking_confirmation_insert(repeat('99',32),(select (value->>'lease_id')::uuid from begin_wins_claim),'2026-09-15T10:59:01Z'),true,'begin wins by crossing the INSERTING fence');
select throws_ok($$select public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000060','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-27T09:30:00.000Z","endUtc":"2026-09-27T10:30:00.000Z"}]','2026-09-15T11:01:00Z')$$,'23P01',null,'begin-wins prevents a post-expiry overlapping offer');
reset role;
select is((select status::text from public.booking_offer where id=(select offer_id from begin_wins_offer)),'SELECTED_PENDING_CONFIRMATION','begin-wins keeps the offer pending');
select is((select status::text from public.booking_option where offer_id=(select offer_id from begin_wins_offer)),'SELECTED','begin-wins keeps the selected option');
select is((select state::text from public.booking_confirmation_operation where booking_offer_id=(select offer_id from begin_wins_offer)),'INSERTING','begin-wins keeps the irreversible operation state');
set local role service_role;
select is(public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15T11:01:01Z'),0,'explicit expiry still skips INSERTING after create rejection');

select * from finish();
rollback;
