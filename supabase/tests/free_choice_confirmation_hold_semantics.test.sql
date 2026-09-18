begin;
select plan(8);

set local role service_role;
select lives_ok($setup$
 select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v1.free-choice-confirmation-holds.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events']);
 select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','artist@example.test','writer');
 select public.save_artist_availability_rules('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Europe/Dublin',60,0,0,'[{"weekday":1,"start":"09:00","end":"18:00"}]');
 select public.save_booking_offer_expiry_hours('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',24);
 insert into public.customer(id,studio_id,name,status) values
  ('60000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000001','Inserting access client','ACTIVE'),
  ('60000000-0000-0000-0000-000000000082','20000000-0000-0000-0000-000000000001','Inserting booking client','ACTIVE'),
  ('60000000-0000-0000-0000-000000000083','20000000-0000-0000-0000-000000000001','Orphan confirmed access client','ACTIVE'),
  ('60000000-0000-0000-0000-000000000084','20000000-0000-0000-0000-000000000001','Orphan confirmed booking client','ACTIVE'),
  ('60000000-0000-0000-0000-000000000085','20000000-0000-0000-0000-000000000001','Confirmed access client','ACTIVE'),
  ('60000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000001','Confirmed booking client','ACTIVE');
 insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values
  ('70000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000081','Inserting free choice','50000000-0000-0000-0000-000000000001','OPEN'),
  ('70000000-0000-0000-0000-000000000082','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000082','Inserting booking','50000000-0000-0000-0000-000000000001','OPEN'),
  ('70000000-0000-0000-0000-000000000083','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000083','Orphan confirmed free choice','50000000-0000-0000-0000-000000000001','OPEN'),
  ('70000000-0000-0000-0000-000000000084','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000084','Orphan confirmed booking','50000000-0000-0000-0000-000000000001','OPEN'),
  ('70000000-0000-0000-0000-000000000085','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000085','Confirmed free choice','50000000-0000-0000-0000-000000000001','OPEN'),
  ('70000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000086','Confirmed booking','50000000-0000-0000-0000-000000000001','OPEN');
 select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000081','50000000-0000-0000-0000-000000000001',repeat('81',32),'2026-09-23T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T23:00:00Z','2026-09-20T08:00:00Z');
 select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000083','50000000-0000-0000-0000-000000000001',repeat('83',32),'2026-09-24T00:00:00Z','2026-09-25T00:00:00Z',60,'2026-09-24T23:00:00Z','2026-09-20T08:00:00Z');
 select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000085','50000000-0000-0000-0000-000000000001',repeat('85',32),'2026-09-25T00:00:00Z','2026-09-26T00:00:00Z',60,'2026-09-25T23:00:00Z','2026-09-20T08:00:00Z');
 create temporary table inserting_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000082','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-23T09:00:00.000Z","endUtc":"2026-09-23T10:00:00.000Z"}]','2026-09-20T08:00:00Z')->>'id')::uuid offer_id;
 select public.rotate_booking_offer_public_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select offer_id from inserting_offer),repeat('82',32),'2026-09-20T08:01:00Z');
 create temporary table inserting_selector as select public.get_public_booking_offer(repeat('82',32),'2026-09-20T08:02:00Z')->'options'->0->>'selector' selector;
 select public.select_public_booking_offer(repeat('82',32),(select selector from inserting_selector),'2026-09-20T08:03:00Z');
 create temporary table inserting_claim as select public.claim_public_booking_confirmation(repeat('82',32),'inkendarholdsemantics1',repeat('H',43),'2026-09-20T08:04:00Z') value;
$setup$,'confirmation hold fixtures are ready');
select is(public.begin_public_booking_confirmation_insert(repeat('82',32),(select (value->>'lease_id')::uuid from inserting_claim),'2026-09-20T08:05:00Z'),true,'selection crosses the durable INSERTING fence');
select is((select count(*) from jsonb_array_elements(public.get_public_free_choice_availability_context(repeat('81',32),'2026-09-21T09:00:00Z')->'holds') hold where hold->>'start_at'='2026-09-23T09:00:00+00:00'),1::bigint,'GET keeps expired INSERTING selection busy');
select throws_ok($$select public.select_public_free_choice_availability(repeat('81',32),repeat('91',32),'2026-09-23T09:00:00Z','2026-09-23T10:00:00Z','2026-09-21T09:00:00Z')$$,'P0002',null,'POST cannot overlap expired INSERTING selection');

create temporary table orphan_confirmed_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000084','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-24T09:00:00.000Z","endUtc":"2026-09-24T10:00:00.000Z"}]','2026-09-20T08:00:00Z')->>'id')::uuid offer_id;
reset role;
update public.booking_offer set status='CONFIRMED' where id=(select offer_id from orphan_confirmed_offer);
update public.booking_option set status='CONFIRMED' where offer_id=(select offer_id from orphan_confirmed_offer);
set local role service_role;
select is((select count(*) from jsonb_array_elements(public.get_public_free_choice_availability_context(repeat('83',32),'2026-09-20T09:00:00Z')->'holds') hold where hold->>'start_at'='2026-09-24T09:00:00+00:00'),0::bigint,'GET ignores malformed CONFIRMED state without appointment');
select lives_ok($$select public.select_public_free_choice_availability(repeat('83',32),repeat('93',32),'2026-09-24T09:00:00Z','2026-09-24T10:00:00Z','2026-09-20T09:00:00Z')$$,'POST ignores malformed CONFIRMED state without appointment');

create temporary table confirmed_offer as select (public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000086','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-25T09:00:00.000Z","endUtc":"2026-09-25T10:00:00.000Z"}]','2026-09-20T08:00:00Z')->>'id')::uuid offer_id;
reset role;
update public.booking_offer set status='CONFIRMED' where id=(select offer_id from confirmed_offer);
update public.booking_option set status='CONFIRMED' where offer_id=(select offer_id from confirmed_offer);
insert into public.appointment(studio_id,tattoo_case_id,artist_profile_id,booking_offer_id,booking_option_id,status,confirmed_at,created_at)
 select '20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000086','50000000-0000-0000-0000-000000000001',offer.offer_id,option.id,'CONFIRMED','2026-09-20T08:10:00Z','2026-09-20T08:10:00Z' from confirmed_offer offer join public.booking_option option on option.offer_id=offer.offer_id;
set local role service_role;
select is((select count(*) from jsonb_array_elements(public.get_public_free_choice_availability_context(repeat('85',32),'2026-09-20T09:00:00Z')->'holds') hold where hold->>'start_at'='2026-09-25T09:00:00+00:00'),1::bigint,'GET keeps only a real CONFIRMED appointment busy');
select throws_ok($$select public.select_public_free_choice_availability(repeat('85',32),repeat('95',32),'2026-09-25T09:00:00Z','2026-09-25T10:00:00Z','2026-09-20T09:00:00Z')$$,'P0002',null,'POST cannot overlap a real CONFIRMED appointment');

select * from finish();
rollback;
