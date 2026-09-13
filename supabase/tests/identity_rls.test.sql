begin;

select plan(38);

select has_type('public', 'membership_role', 'membership_role enum exists');
select enum_has_labels(
  'public',
  'membership_role',
  array['OWNER', 'ARTIST'],
  'membership_role contains only OWNER and ARTIST'
);

select has_table('public', 'studio', 'studio table exists');
select has_table('public', 'user_profile', 'user_profile table exists');
select has_table('public', 'membership', 'membership table exists');
select has_table('public', 'artist_profile', 'artist_profile table exists');

select col_is_fk('public', 'user_profile', 'studio_id', 'user_profile belongs to a studio');
select col_is_fk('public', 'membership', 'studio_id', 'membership belongs to a studio');
select col_is_fk('public', 'membership', 'user_id', 'membership belongs to an auth user');
select col_is_fk('public', 'artist_profile', 'studio_id', 'artist_profile belongs to a studio');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select results_eq(
  $$ select name from public.studio order by name $$,
  $$ values ('North Ink Studio'::text) $$,
  'owner reads only their studio'
);

select results_eq(
  $$ select display_name from public.user_profile order by display_name $$,
  $$ values ('North Artist'::text), ('North Owner'::text) $$,
  'owner reads every user profile in their studio'
);

select results_eq(
  $$ select role::text from public.membership order by role::text $$,
  $$ values ('ARTIST'::text), ('OWNER'::text) $$,
  'owner reads every membership in their studio'
);

select lives_ok(
  $$ update public.studio set name = 'North Ink Studio Updated' where id = '20000000-0000-0000-0000-000000000001' $$,
  'owner can update their studio'
);

select results_eq(
  $$ update public.studio set name = 'Forbidden' where id = '20000000-0000-0000-0000-000000000002' returning id $$,
  $$ select null::uuid where false $$,
  'owner cannot update another studio'
);

select lives_ok(
  $$
    insert into public.user_profile (id, studio_id, user_id, display_name)
    values (
      '30000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004',
      'Second North Artist'
    )
  $$,
  'owner can create a profile in their studio'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);

select results_eq(
  $$ select id from public.user_profile $$,
  $$ select null::uuid where false $$,
  'a profile without an artist membership does not grant access'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$
    insert into public.membership (id, studio_id, user_id, user_profile_id, role)
    values (
      '40000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004',
      '30000000-0000-0000-0000-000000000002',
      'ARTIST'
    )
  $$,
  '23503',
  null,
  'membership cannot impersonate another user profile in the same studio'
);

delete from public.membership
where id = '40000000-0000-0000-0000-000000000005';

select lives_ok(
  $$
    insert into public.membership (id, studio_id, user_id, user_profile_id, role)
    values (
      '40000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004',
      '30000000-0000-0000-0000-000000000004',
      'ARTIST'
    )
  $$,
  'owner can create an artist membership in their studio'
);

select lives_ok(
  $$
    insert into public.artist_profile (id, studio_id, membership_id, user_id, display_name)
    values (
      '50000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000004',
      'Second North Portfolio'
    )
  $$,
  'owner can create an artist profile in their studio'
);

select results_eq(
  $$
    update public.user_profile
    set display_name = 'Forbidden'
    where studio_id = '20000000-0000-0000-0000-000000000002'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'owner cannot update a profile in another studio'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select results_eq(
  $$ select user_id from public.membership $$,
  $$ values ('10000000-0000-0000-0000-000000000002'::uuid) $$,
  'artist reads only their membership'
);

select results_eq(
  $$ select display_name from public.user_profile $$,
  $$ values ('North Artist'::text) $$,
  'artist reads only their user profile'
);

select results_eq(
  $$ select display_name from public.artist_profile $$,
  $$ values ('North Artist Portfolio'::text) $$,
  'artist reads only their artist profile'
);

select results_eq(
  $$ select id from public.studio $$,
  $$ select null::uuid where false $$,
  'artist cannot read the studio row'
);

select results_eq(
  $$ update public.user_profile set display_name = 'Escalated' returning id $$,
  $$ select null::uuid where false $$,
  'artist cannot update their own profile'
);

select results_eq(
  $$ update public.membership set role = 'OWNER' returning id $$,
  $$ select null::uuid where false $$,
  'artist cannot promote their own membership'
);

select results_eq(
  $$ delete from public.artist_profile returning id $$,
  $$ select null::uuid where false $$,
  'artist cannot delete their own artist profile'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

select results_eq(
  $$ select name from public.studio order by name $$,
  $$ values ('South Ink Studio'::text) $$,
  'user from another studio reads only that studio'
);

select results_eq(
  $$ select count(*)::bigint from public.membership where studio_id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values (0::bigint) $$,
  'user from another studio cannot list first-studio memberships'
);

select results_eq(
  $$ delete from public.artist_profile where studio_id = '20000000-0000-0000-0000-000000000001' returning id $$,
  $$ select null::uuid where false $$,
  'user from another studio cannot delete first-studio profiles'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.studio $$,
  '42501',
  null,
  'anonymous requests cannot read studios'
);

select throws_ok(
  $$ select * from public.membership $$,
  '42501',
  null,
  'anonymous requests cannot read memberships'
);

select throws_ok(
  $$ insert into public.studio (name) values ('Anonymous Studio') $$,
  '42501',
  null,
  'anonymous requests cannot create studios'
);

reset role;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.studio'::regclass),
  'RLS is enabled on studio'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_profile'::regclass),
  'RLS is enabled on user_profile'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.membership'::regclass),
  'RLS is enabled on membership'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.artist_profile'::regclass),
  'RLS is enabled on artist_profile'
);

select * from finish();
rollback;
