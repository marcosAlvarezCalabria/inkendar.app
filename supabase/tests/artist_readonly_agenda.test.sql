begin;

select plan(27);

select has_function('public', 'get_artist_agenda', array['timestamp with time zone', 'integer'], 'artist agenda RPC exists');
select function_returns('public', 'get_artist_agenda', array['timestamp with time zone', 'integer'], 'setof record', 'artist agenda returns a bounded record set');
select is(
  (select proconfig from pg_proc where oid = 'public.get_artist_agenda(timestamptz,integer)'::regprocedure),
  array['search_path=""'],
  'artist agenda fixes an empty search path'
);
select ok(has_function_privilege('authenticated', 'public.get_artist_agenda(timestamptz,integer)', 'execute'), 'authenticated may execute the identity-bound reader');
select ok(not has_function_privilege('anon', 'public.get_artist_agenda(timestamptz,integer)', 'execute'), 'anonymous cannot execute the reader');
select ok(not has_function_privilege('service_role', 'public.get_artist_agenda(timestamptz,integer)', 'execute'), 'service role does not bypass the actor-bound reader');
select is(
  (select proargnames[3:9] from pg_proc where oid = 'public.get_artist_agenda(timestamptz,integer)'::regprocedure),
  array['start_at', 'end_at', 'customer_display_name', 'case_summary', 'body_area', 'size', 'time_zone']::text[],
  'RPC output contains only the minimum artist agenda contract'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000005','authenticated','authenticated','north.second-artist@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000006','authenticated','authenticated','south.artist@example.test','',now(),'{}','{}',now(),now());

insert into public.user_profile(id,studio_id,user_id,display_name) values
('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','Second North Artist'),
('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','South Artist');
insert into public.membership(id,studio_id,user_id,user_profile_id,role) values
('40000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000005','ARTIST'),
('40000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000006','ARTIST');
insert into public.artist_profile(id,studio_id,membership_id,user_id,display_name) values
('50000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','Second North Portfolio'),
('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','South Portfolio');

insert into public.customer(id,studio_id,name,email,phone,status) values
('60000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000001','Agenda primary','agenda-primary@example.test','+353800000090','ACTIVE'),
('60000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000001','Other artist private','other-artist@example.test','+353800000091','ACTIVE'),
('60000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000002','Other tenant private','other-tenant@example.test','+353800000092','ACTIVE');
insert into public.tattoo_case(id,studio_id,customer_id,summary,body_area,size,artist_profile_id,status) values
('70000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000090','Agenda case','Brazo','Mediana','50000000-0000-0000-0000-000000000001','OPEN'),
('70000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091','Other artist case',null,null,'50000000-0000-0000-0000-000000000005','OPEN'),
('70000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000092','Other tenant case',null,null,'50000000-0000-0000-0000-000000000006','OPEN');
insert into public.artist_availability_rule(artist_profile_id,studio_id,time_zone,slot_increment_minutes,buffer_before_minutes,buffer_after_minutes)
values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Europe/Dublin',30,0,0);

do $$
declare
  item record;
  v_offer_id uuid;
  v_option_id uuid;
begin
  for item in select sequence from generate_series(0, 51) as sequence loop
    v_offer_id := gen_random_uuid();
    v_option_id := gen_random_uuid();
    insert into public.booking_offer(id,studio_id,tattoo_case_id,artist_profile_id,status,expires_at)
    values(v_offer_id,'20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000090','50000000-0000-0000-0000-000000000001','CONFIRMED',now() + interval '1 day');
    insert into public.booking_option(id,offer_id,studio_id,artist_profile_id,start_at,end_at,status)
    values(
      v_option_id,v_offer_id,'20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
      case when item.sequence = 0 then now() - interval '1 hour' else now() + item.sequence * interval '1 hour' end,
      case when item.sequence = 0 then now() else now() + (item.sequence + 1) * interval '1 hour' end,
      'CONFIRMED'
    );
    insert into public.appointment(studio_id,tattoo_case_id,artist_profile_id,booking_offer_id,booking_option_id,status,confirmed_at)
    values('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000090','50000000-0000-0000-0000-000000000001',v_offer_id,v_option_id,'CONFIRMED',now());
  end loop;
end $$;

insert into public.booking_offer(id,studio_id,tattoo_case_id,artist_profile_id,status,expires_at) values
('71000000-0000-4000-8000-000000000090','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000090','50000000-0000-0000-0000-000000000001','CONFIRMED',now()+interval '1 day'),
('71000000-0000-4000-8000-000000000091','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000091','50000000-0000-0000-0000-000000000005','CONFIRMED',now()+interval '1 day'),
('71000000-0000-4000-8000-000000000092','20000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000092','50000000-0000-0000-0000-000000000006','CONFIRMED',now()+interval '1 day');
insert into public.booking_option(id,offer_id,studio_id,artist_profile_id,start_at,end_at,status) values
('72000000-0000-4000-8000-000000000090','71000000-0000-4000-8000-000000000090','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',now()-interval '3 hours',now()-interval '2 hours','CONFIRMED'),
('72000000-0000-4000-8000-000000000091','71000000-0000-4000-8000-000000000091','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',now()+interval '30 minutes',now()+interval '90 minutes','CONFIRMED'),
('72000000-0000-4000-8000-000000000092','71000000-0000-4000-8000-000000000092','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000006',now()+interval '30 minutes',now()+interval '90 minutes','CONFIRMED');
insert into public.appointment(studio_id,tattoo_case_id,artist_profile_id,booking_offer_id,booking_option_id,status,confirmed_at) values
('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000090','50000000-0000-0000-0000-000000000001','71000000-0000-4000-8000-000000000090','72000000-0000-4000-8000-000000000090','CONFIRMED',now()),
('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000091','50000000-0000-0000-0000-000000000005','71000000-0000-4000-8000-000000000091','72000000-0000-4000-8000-000000000091','CONFIRMED',now()),
('20000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000092','50000000-0000-0000-0000-000000000006','71000000-0000-4000-8000-000000000092','72000000-0000-4000-8000-000000000092','CONFIRMED',now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select is((select count(*) from public.get_artist_agenda(now(), 50)), 50::bigint, 'agenda is capped at the fixed maximum');
select is((select count(*) from public.get_artist_agenda(now(), 50) where end_at = now()), 1::bigint, 'exact end boundary is included');
select is((select count(*) from public.get_artist_agenda(now() - interval '1 day', 50) where end_at < now()), 0::bigint, 'database now prevents callers from reading past appointments');
select is((select count(*) from public.get_artist_agenda(now(), 50) where customer_display_name = 'Other artist private'), 0::bigint, 'artist never reads another artist appointment');
select is((select count(*) from public.get_artist_agenda(now(), 50) where customer_display_name = 'Other tenant private'), 0::bigint, 'artist never reads another tenant appointment');
select is((select bool_and(customer_display_name = 'Agenda primary') from public.get_artist_agenda(now(), 50)), true, 'only the assigned customer display name is returned');
select is((select bool_and(case_summary = 'Agenda case') from public.get_artist_agenda(now(), 50)), true, 'only assigned case summaries are returned');
select is((select bool_and(body_area = 'Brazo' and size = 'Mediana') from public.get_artist_agenda(now(), 50)), true, 'optional preparation fields are returned');
select is((select bool_and(time_zone = 'Europe/Dublin') from public.get_artist_agenda(now(), 50)), true, 'authoritative artist availability timezone is returned');
select is((select array_agg(start_at) = array_agg(start_at order by start_at) from public.get_artist_agenda(now(), 50)), true, 'agenda is ordered by start ascending');
select throws_ok($$ select * from public.get_artist_agenda(now(), 51) $$, '42501', 'artist agenda unavailable', 'caller cannot exceed the bound');
select throws_ok($$ select * from public.appointment $$, '42501', null, 'artist has no general appointment table access');
select throws_ok($$ select * from public.booking_option $$, '42501', null, 'artist has no general booking option access');
select results_eq($$ update public.tattoo_case set summary = 'Forbidden' returning id $$, $$ select null::uuid where false $$, 'artist cannot update cases');
select results_eq($$ update public.customer set name = 'Forbidden' returning id $$, $$ select null::uuid where false $$, 'artist cannot update customers');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select is((select count(*) from public.get_artist_agenda(now(), 50)), 1::bigint, 'second artist sees only their own appointment');
select is((select time_zone from public.get_artist_agenda(now(), 50)), 'UTC'::text, 'missing availability configuration uses explicit UTC');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select * from public.get_artist_agenda(now(), 50) $$, '42501', 'artist agenda unavailable', 'owner cannot use the ARTIST reader');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select throws_ok($$ select * from public.get_artist_agenda(now(), 50) $$, '42501', 'artist agenda unavailable', 'identity without a coherent artist profile fails closed');

reset role;
set local role anon;
select throws_ok($$ select * from public.get_artist_agenda(now(), 50) $$, '42501', null, 'anonymous cannot call the reader');

select * from finish();
rollback;
