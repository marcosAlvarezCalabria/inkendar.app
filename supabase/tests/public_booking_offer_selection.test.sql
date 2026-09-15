begin;
select plan(36);

select has_column('public', 'booking_option', 'public_selector', 'booking options have a separate public selector');
select col_type_is('public', 'booking_option', 'public_selector', 'uuid', 'public selector is UUID');
select ok((select attnotnull from pg_attribute where attrelid = 'public.booking_option'::regclass and attname = 'public_selector'), 'public selector is required');
select ok('SELECTED_PENDING_CONFIRMATION' = any(enum_range(null::public.booking_offer_status)::text[]), 'offer has an explicit pending-confirmation state');
select ok('SELECTED' = any(enum_range(null::public.booking_option_status)::text[]), 'option has a selected state');
select has_function('public', 'select_public_booking_offer', array['text','text','timestamp with time zone'], 'public selection RPC exists');
select ok(has_function_privilege('service_role', 'public.select_public_booking_offer(text,text,timestamptz)', 'execute'), 'service role can select publicly');
select ok(not has_function_privilege('anon', 'public.select_public_booking_offer(text,text,timestamptz)', 'execute'), 'anonymous browser cannot call selection RPC directly');
select ok(not has_function_privilege('authenticated', 'public.select_public_booking_offer(text,text,timestamptz)', 'execute'), 'authenticated browser cannot call selection RPC directly');
select is((select proconfig from pg_proc where oid = 'public.select_public_booking_offer(text,text,timestamptz)'::regprocedure), array['search_path=""'], 'selection RPC fixes an empty search path');
select ok((select prosrc ilike '%for update%of offer%' from pg_proc where oid = 'public.select_public_booking_offer(text,text,timestamptz)'::regprocedure), 'selection locks the resolved offer before choosing a winner');

set local role service_role;
insert into public.customer(id, studio_id, name, status) values ('60000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000001', 'Selection client', 'ACTIVE');
insert into public.tattoo_case(id, studio_id, customer_id, summary, artist_profile_id, status) values ('70000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000030', 'Private selection case', '50000000-0000-0000-0000-000000000001', 'OPEN');
create temporary table selection_offer_fixture(offer_id uuid primary key);
insert into selection_offer_fixture
select (public.create_booking_offer(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000030',
  '50000000-0000-0000-0000-000000000001',
  '[{"startUtc":"2026-09-20T09:00:00.000Z","endUtc":"2026-09-20T10:00:00.000Z"},{"startUtc":"2026-09-21T09:00:00.000Z","endUtc":"2026-09-21T10:00:00.000Z"}]',
  '2026-09-15T10:00:00Z'
)->>'id')::uuid;
select lives_ok(format(
  'select public.rotate_booking_offer_public_access(%L,%L,%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  (select offer_id from selection_offer_fixture),
  repeat('12', 32),
  '2026-09-15T10:01:00Z'
), 'current offer receives public access');

select is(public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:02:00Z')->>'state', 'OPEN', 'GET exposes the open public state');
select is(jsonb_array_length(public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:02:00Z')->'options'), 2, 'GET exposes both held options before selection');
select ok((select bool_and(value ? 'selector' and not value ?| array['id','offer_id','studio_id','artist_profile_id','status']) from jsonb_array_elements(public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:02:00Z')->'options')), 'GET exposes selectors but no internal option fields');

create temporary table selection_selector_fixture(chosen text primary key, competitor text not null);
insert into selection_selector_fixture
select public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:02:00Z')->'options'->0->>'selector',
       public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:02:00Z')->'options'->1->>'selector';

reset role;
select ok((select chosen ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from selection_selector_fixture), 'chosen selector is canonical UUID v4');
select ok((select chosen <> competitor from selection_selector_fixture), 'each option has a distinct selector');
select ok((select bool_and(option.public_selector <> option.id) from public.booking_option option where option.offer_id = (select offer_id from selection_offer_fixture)), 'selectors are separate from internal option IDs');

set local role service_role;
select is(public.select_public_booking_offer(repeat('12', 32), (select chosen from selection_selector_fixture), '2026-09-15T10:03:00Z')->>'state', 'SELECTION_PENDING_CONFIRMATION', 'first selection returns pending confirmation');
reset role;
select is((select status::text from public.booking_offer where id = (select offer_id from selection_offer_fixture)), 'SELECTED_PENDING_CONFIRMATION', 'offer transitions atomically to pending confirmation');
select is((select count(*) from public.booking_option where offer_id = (select offer_id from selection_offer_fixture) and status = 'SELECTED'), 1::bigint, 'exactly one option is selected');
select is((select count(*) from public.booking_option where offer_id = (select offer_id from selection_offer_fixture) and status = 'RELEASED'), 1::bigint, 'all competing options are released');

set local role service_role;
select is(public.select_public_booking_offer(repeat('12', 32), (select chosen from selection_selector_fixture), '2026-09-15T10:04:00Z')->>'state', 'SELECTION_PENDING_CONFIRMATION', 'same selection is idempotent');
select throws_ok(format('select public.select_public_booking_offer(%L,%L,%L)', repeat('12', 32), (select competitor from selection_selector_fixture), '2026-09-15T10:04:00Z'), 'P0003', null, 'competing selection cannot replace the locked winner');
select throws_ok(format('select public.select_public_booking_offer(%L,%L,%L)', repeat('12', 32), upper((select chosen from selection_selector_fixture)), '2026-09-15T10:04:00Z'), '22023', null, 'non-canonical selector is rejected');
select throws_ok($$select public.select_public_booking_offer(repeat('34', 32), 'a0000000-0000-4000-8000-000000000001', '2026-09-15T10:04:00Z')$$, 'P0002', null, 'unknown token hash is uniformly unavailable');
select is(public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:05:00Z')->>'state', 'SELECTION_PENDING_CONFIRMATION', 'subsequent GET remains pending confirmation');
select is(jsonb_array_length(public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:05:00Z')->'options'), 1, 'subsequent GET contains only the chosen interval');
select ok((select not (public.get_public_booking_offer(repeat('12', 32), '2026-09-15T10:05:00Z')->'options'->0) ?| array['selector','id','status']), 'pending GET exposes neither selector nor internal fields');
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-20T00:00:00Z','2026-09-22T00:00:00Z','2026-09-15T10:05:00Z')), 1::bigint, 'selected option remains an active hold');
select is(public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-16T10:00:00Z'), 1, 'pending selection expires at its deadline');
reset role;
select is((select status::text from public.booking_offer where id = (select offer_id from selection_offer_fixture)), 'EXPIRED', 'expired pending offer is materialized');
select ok((select bool_and(status = 'RELEASED') from public.booking_option where offer_id = (select offer_id from selection_offer_fixture)), 'expiry releases the selected option');
set local role service_role;
select is((select count(*) from public.list_active_booking_holds('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','2026-09-20T00:00:00Z','2026-09-22T00:00:00Z','2026-09-16T10:00:00Z')), 0::bigint, 'expired selection no longer blocks availability');
select is(public.expire_booking_offers('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-17T10:00:00Z'), 0, 'pending-selection expiry remains idempotent');
select is(public.get_public_booking_offer(repeat('12', 32), '2026-09-16T10:00:00Z'), null::jsonb, 'expired selected offer is uniformly unavailable');

select * from finish();
rollback;
