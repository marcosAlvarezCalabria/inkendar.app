begin;

select plan(21);

select has_function('public', 'provision_studio_owner', array['uuid', 'text', 'text'], 'owner provisioning function exists');
select has_function('public', 'provision_studio_artist', array['uuid', 'uuid', 'text'], 'artist provisioning function exists');

select ok(
  has_function_privilege('service_role', 'public.provision_studio_owner(uuid,text,text)', 'EXECUTE'),
  'service_role can provision an owner'
);
select ok(
  has_function_privilege('service_role', 'public.provision_studio_artist(uuid,uuid,text)', 'EXECUTE'),
  'service_role can provision an artist'
);
select ok(
  not has_function_privilege('authenticated', 'public.provision_studio_owner(uuid,text,text)', 'EXECUTE'),
  'authenticated cannot provision an owner'
);
select ok(
  not has_function_privilege('authenticated', 'public.provision_studio_artist(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot provision an artist'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000005',
    'authenticated', 'authenticated', 'manual.owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000006',
    'authenticated', 'authenticated', 'manual.artist@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

set local role service_role;

select lives_ok(
  $$ select * from public.provision_studio_owner(
    '10000000-0000-0000-0000-000000000005', 'Manual Studio', 'Manual Owner'
  ) $$,
  'service_role provisions a studio and owner atomically'
);

select results_eq(
  $$
    select m.role::text
    from public.membership m
    join public.studio s on s.id = m.studio_id
    join public.user_profile up on up.id = m.user_profile_id
    where s.name = 'Manual Studio'
      and m.user_id = '10000000-0000-0000-0000-000000000005'
      and up.user_id = m.user_id
      and up.studio_id = m.studio_id
  $$,
  $$ values ('OWNER'::text) $$,
  'owner membership and profile share the created tenant and identity'
);

select results_eq(
  $$
    select * from public.provision_studio_owner(
      '10000000-0000-0000-0000-000000000005', 'Manual Studio', 'Manual Owner'
    )
  $$,
  $$
    select s.id, up.id, m.id
    from public.membership m
    join public.studio s on s.id = m.studio_id
    join public.user_profile up on up.id = m.user_profile_id
    where m.user_id = '10000000-0000-0000-0000-000000000005'
  $$,
  'repeating the same owner request returns the original identifiers'
);

select results_eq(
  $$ select count(*)::bigint from public.studio where name = 'Manual Studio' $$,
  $$ values (1::bigint) $$,
  'repeating owner provisioning does not duplicate the studio'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.membership
    where user_id = '10000000-0000-0000-0000-000000000005'
  $$,
  $$ values (1::bigint) $$,
  'repeating owner provisioning does not duplicate membership'
);

select lives_ok(
  $$ select * from public.provision_studio_artist(
    '10000000-0000-0000-0000-000000000006',
    (select id from public.studio where name = 'Manual Studio'),
    'Manual Artist'
  ) $$,
  'service_role provisions an artist in an existing studio atomically'
);

select results_eq(
  $$
    select m.role::text
    from public.membership m
    join public.artist_profile ap
      on ap.membership_id = m.id
      and ap.studio_id = m.studio_id
      and ap.user_id = m.user_id
    where m.user_id = '10000000-0000-0000-0000-000000000006'
  $$,
  $$ values ('ARTIST'::text) $$,
  'artist membership and artist profile share tenant, identity and fixed role'
);

select results_eq(
  $$
    select * from public.provision_studio_artist(
      '10000000-0000-0000-0000-000000000006',
      (select id from public.studio where name = 'Manual Studio'),
      'Manual Artist'
    )
  $$,
  $$
    select up.id, m.id, ap.id
    from public.membership m
    join public.user_profile up on up.id = m.user_profile_id
    join public.artist_profile ap on ap.membership_id = m.id
    where m.user_id = '10000000-0000-0000-0000-000000000006'
  $$,
  'repeating the same artist request returns the original identifiers'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.user_profile
    where user_id = '10000000-0000-0000-0000-000000000006'
  $$,
  $$ values (1::bigint) $$,
  'repeating artist provisioning does not duplicate the profile'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.artist_profile
    where user_id = '10000000-0000-0000-0000-000000000006'
  $$,
  $$ values (1::bigint) $$,
  'repeating artist provisioning does not duplicate the artist profile'
);

select throws_ok(
  $$ select * from public.provision_studio_artist(
    '10000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000099',
    'Missing Studio Artist'
  ) $$,
  'P0001', 'STUDIO_NOT_FOUND',
  'missing studios are rejected with a stable error'
);

select throws_ok(
  $$ select * from public.provision_studio_artist(
    '10000000-0000-0000-0000-000000000005',
    (select id from public.studio where name = 'Manual Studio'),
    'Duplicate Owner'
  ) $$,
  'P0001', 'DUPLICATE_IDENTITY',
  'an existing membership cannot be provisioned again'
);

select throws_ok(
  $$ select * from public.provision_studio_owner(
    '10000000-0000-0000-0000-000000000099', 'Rolled Back Studio', 'Missing Auth User'
  ) $$,
  '23503', null,
  'a persistence failure aborts owner provisioning'
);

select results_eq(
  $$ select count(*)::bigint from public.studio where name = 'Rolled Back Studio' $$,
  $$ values (0::bigint) $$,
  'failed owner provisioning rolls back the studio insert'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select * from public.provision_studio_owner(
    '10000000-0000-0000-0000-000000000004', 'Forbidden Studio', 'Forbidden Owner'
  ) $$,
  '42501', null,
  'authenticated execution is rejected'
);

select * from finish();
rollback;
