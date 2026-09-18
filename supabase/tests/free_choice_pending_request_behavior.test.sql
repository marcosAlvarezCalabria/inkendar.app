begin;
select plan(39);

select is((select proconfig from pg_proc where oid='public.select_public_free_choice_availability(text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),array['search_path=""'],'selection fixes an empty search path');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.select_public_free_choice_availability(text,text,timestamptz,timestamptz,timestamptz)'::regprocedure))>0,'selection uses a transaction-scoped artist lock');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.select_public_free_choice_availability(text,text,timestamptz,timestamptz,timestamptz)'::regprocedure))<position('from public.booking_option' in pg_get_functiondef('public.select_public_free_choice_availability(text,text,timestamptz,timestamptz,timestamptz)'::regprocedure)),'selection takes the artist lock before deciding local hold conflicts');
select ok(not has_function_privilege('anon','public.get_free_choice_availability_management(uuid,uuid)','execute'),'anonymous cannot read owner management');
select ok(not has_function_privilege('authenticated','public.get_free_choice_availability_management(uuid,uuid)','execute'),'authenticated browser cannot read owner management directly');
set local role anon;
select throws_ok($$select * from public.free_choice_pending_request$$,'42501',null,'anonymous cannot read pending requests through RLS');
reset role;

set local role service_role;
select lives_ok($setup$
  select public.activate_google_calendar_connection('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','v1.pending-choice-ciphertext.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy']);
  select public.assign_artist_calendar('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','artist@example.test','writer');
  select public.save_artist_availability_rules('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Europe/Dublin',60,0,0,'[{"weekday":1,"start":"09:00","end":"18:00"}]');
  insert into public.customer(id,studio_id,name,status) values
    ('60000000-0000-0000-0000-000000000071','20000000-0000-0000-0000-000000000001','Pending client one','ACTIVE'),
    ('60000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000001','Pending client two','ACTIVE'),
    ('60000000-0000-0000-0000-000000000073','20000000-0000-0000-0000-000000000001','Pending client three','ACTIVE'),
    ('60000000-0000-0000-0000-000000000074','20000000-0000-0000-0000-000000000001','Pending client four','ACTIVE'),
    ('60000000-0000-0000-0000-000000000075','20000000-0000-0000-0000-000000000001','Pending client archived','ACTIVE');
  insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status) values
    ('70000000-0000-0000-0000-000000000071','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000071','Policy expiry case','50000000-0000-0000-0000-000000000001','OPEN'),
    ('70000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000072','Competing case','50000000-0000-0000-0000-000000000001','OPEN'),
    ('70000000-0000-0000-0000-000000000073','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000073','Link expiry case','50000000-0000-0000-0000-000000000001','OPEN'),
    ('70000000-0000-0000-0000-000000000074','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000074','Start expiry case','50000000-0000-0000-0000-000000000001','OPEN'),
    ('70000000-0000-0000-0000-000000000075','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000075','Archived case','50000000-0000-0000-0000-000000000001','ARCHIVED');
  select public.save_booking_offer_expiry_hours('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',24);
$setup$,'same-tenant owner fixture is ready');

select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000071','50000000-0000-0000-0000-000000000001',repeat('11',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'owner issues a case-bound access for an OPEN assigned case');
reset role;
select is((select tattoo_case_id from public.free_choice_availability_access where token_hash=decode(repeat('11',32),'hex')),'70000000-0000-0000-0000-000000000071'::uuid,'access is bound to the intended case');

set local role service_role;
select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000071','50000000-0000-0000-0000-000000000001',repeat('12',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:01:00Z')$$,'same case rotates independently');
select is(public.get_public_free_choice_availability_context(repeat('11',32),'2026-09-20T09:00:00Z'),null::jsonb,'rotated token is unavailable');
select isnt(public.get_public_free_choice_availability_context(repeat('12',32),'2026-09-20T09:00:00Z'),null::jsonb,'replacement token resolves');
select throws_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000075','50000000-0000-0000-0000-000000000001',repeat('13',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'P0002',null,'archived case fails closed');
select throws_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000071','50000000-0000-0000-0000-000000000001',repeat('13',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'P0002',null,'cross-tenant case and artist fail closed');
select throws_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000071','50000000-0000-0000-0000-000000000001',repeat('13',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'42501',null,'ARTIST cannot issue case-bound access');

select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',repeat('20',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'legacy query-only access remains issuable');
select throws_ok($$select public.select_public_free_choice_availability(repeat('20',32),repeat('21',32),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-20T09:00:00Z')$$,'P0002',null,'legacy access cannot materialize a POST selection');
select throws_ok($$select public.select_public_free_choice_availability(repeat('12',32),repeat('21',32),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-23T12:00:00Z')$$,'P0002',null,'expired access cannot select');

create temporary table first_selection as select public.select_public_free_choice_availability(repeat('12',32),repeat('31',32),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-20T09:00:00Z') value;
select is((select value->>'expires_at' from first_selection),'2026-09-21T09:00:00+00:00','pending expiry uses the studio policy when it is earliest');
reset role;
select is((select status::text from public.free_choice_pending_request where tattoo_case_id='70000000-0000-0000-0000-000000000071'),'PENDING_OWNER_APPROVAL','selection creates a durable pending request');
select is((select count(*) from public.free_choice_pending_request where tattoo_case_id='70000000-0000-0000-0000-000000000071'),1::bigint,'selection creates exactly one request');

set local role service_role;
select is(public.select_public_free_choice_availability(repeat('12',32),repeat('31',32),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-20T09:01:00Z')->>'start_at','2026-09-22T09:00:00+00:00','identical retry is idempotent');
select throws_ok($$select public.select_public_free_choice_availability(repeat('12',32),repeat('32',32),'2026-09-22T09:00:00Z','2026-09-22T10:00:00Z','2026-09-20T09:01:00Z')$$,'P0002',null,'a competing selector cannot replace the winner');
select throws_ok($$select public.select_public_free_choice_availability(repeat('12',32),repeat('31',32),'2026-09-22T10:00:00Z','2026-09-22T11:00:00Z','2026-09-20T09:01:00Z')$$,'P0002',null,'a competing interval cannot replace the winner');
select is((public.get_public_free_choice_availability_context(repeat('12',32),'2026-09-20T09:02:00Z')->'pending_request'->>'start_at'),'2026-09-22T09:00:00+00:00','subsequent GET resolves only the pending interval');
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-22T00:00:00Z','2026-09-23T00:00:00Z','2026-09-20T09:02:00Z')),1::bigint,'pending request participates in active holds');
select ok((select (value->'pending_requests'->0) ?& array['customer_name','case_summary','artist_display_name','start_at','end_at','expires_at'] and not (value->'pending_requests'->0) ?| array['studio_id','tattoo_case_id','artist_profile_id','access_id','selector_hash'] from (select public.get_free_choice_availability_management('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001') value) management),'owner management exposes minimum useful private context without internal IDs');

select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000072','50000000-0000-0000-0000-000000000001',repeat('40',32),'2026-09-22T00:00:00Z','2026-09-24T00:00:00Z',60,'2026-09-23T12:00:00Z','2026-09-20T08:00:00Z')$$,'second case keeps a distinct access');
select throws_ok($$select public.select_public_free_choice_availability(repeat('40',32),repeat('41',32),'2026-09-22T09:30:00Z','2026-09-22T10:30:00Z','2026-09-20T09:03:00Z')$$,'P0002',null,'overlapping competing request loses under the artist lock');
select throws_ok($$select public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000072','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-22T09:30:00.000Z","endUtc":"2026-09-22T10:30:00.000Z"}]','2026-09-20T09:04:00Z')$$,'23P01',null,'pending free-choice hold blocks a booking offer');
select lives_ok($$select public.create_booking_offer('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000072','50000000-0000-0000-0000-000000000001','[{"startUtc":"2026-09-23T09:00:00.000Z","endUtc":"2026-09-23T10:00:00.000Z"}]','2026-09-20T09:04:00Z')$$,'a non-overlapping booking hold is created');
select throws_ok($$select public.select_public_free_choice_availability(repeat('40',32),repeat('42',32),'2026-09-23T09:00:00Z','2026-09-23T10:00:00Z','2026-09-20T09:05:00Z')$$,'P0002',null,'existing booking hold blocks free-choice selection');

select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000073','50000000-0000-0000-0000-000000000001',repeat('50',32),'2026-09-24T00:00:00Z','2026-09-25T00:00:00Z',60,'2026-09-20T10:00:00Z','2026-09-20T08:00:00Z')$$,'link-expiry fixture is issued');
select is(public.select_public_free_choice_availability(repeat('50',32),repeat('51',32),'2026-09-24T09:00:00Z','2026-09-24T10:00:00Z','2026-09-20T09:00:00Z')->>'expires_at','2026-09-20T10:00:00+00:00','pending expiry uses access expiry when it is earliest');
select lives_ok($$select public.rotate_free_choice_availability_access('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000074','50000000-0000-0000-0000-000000000001',repeat('60',32),'2026-09-20T09:00:00Z','2026-09-21T00:00:00Z',60,'2026-09-21T00:00:00Z','2026-09-20T08:00:00Z')$$,'start-expiry fixture is issued');
select is(public.select_public_free_choice_availability(repeat('60',32),repeat('61',32),'2026-09-20T12:00:00Z','2026-09-20T13:00:00Z','2026-09-20T09:00:00Z')->>'expires_at','2026-09-20T12:00:00+00:00','pending expiry never crosses the slot start');
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-22T00:00:00Z','2026-09-23T00:00:00Z','2026-09-21T09:00:00Z')),0::bigint,'expired pending request is released from availability without deletion');
select is(public.get_public_free_choice_availability_context(repeat('12',32),'2026-09-21T09:00:00Z'),null::jsonb,'consumed access does not advertise slots after its pending request expires');
reset role;
select is((select status::text from public.free_choice_pending_request where tattoo_case_id='70000000-0000-0000-0000-000000000071'),'PENDING_OWNER_APPROVAL','expired request remains durable for audit under the current contract');

select * from finish();
rollback;
