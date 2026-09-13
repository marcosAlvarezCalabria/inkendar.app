create type public.customer_status as enum ('ACTIVE', 'ARCHIVED');
create type public.tattoo_case_status as enum ('OPEN', 'ARCHIVED');

create table public.customer (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text check (
    email is null or (
      email = lower(btrim(email))
      and char_length(email) between 3 and 254
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  status public.customer_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_identity_unique unique (id, studio_id)
);

alter table public.artist_profile
  add constraint artist_profile_identity_studio_unique unique (id, studio_id);

create table public.tattoo_case (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  customer_id uuid not null,
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  body_area text check (body_area is null or char_length(btrim(body_area)) between 1 and 120),
  size text check (size is null or char_length(btrim(size)) between 1 and 120),
  artist_profile_id uuid,
  status public.tattoo_case_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tattoo_case_customer_same_studio_fk
    foreign key (customer_id, studio_id)
    references public.customer(id, studio_id)
    on delete restrict,
  constraint tattoo_case_artist_same_studio_fk
    foreign key (artist_profile_id, studio_id)
    references public.artist_profile(id, studio_id)
    on delete restrict,
  constraint tattoo_case_identity_unique unique (id, studio_id)
);

create unique index customer_studio_email_unique
  on public.customer(studio_id, email)
  where email is not null;
create unique index customer_studio_phone_unique
  on public.customer(studio_id, phone)
  where phone is not null;
create index customer_studio_status_idx on public.customer(studio_id, status);
create index tattoo_case_studio_status_idx on public.tattoo_case(studio_id, status);
create index tattoo_case_studio_customer_idx on public.tattoo_case(studio_id, customer_id);
create index tattoo_case_studio_artist_idx on public.tattoo_case(studio_id, artist_profile_id)
  where artist_profile_id is not null;

alter table public.customer enable row level security;
alter table public.tattoo_case enable row level security;

revoke all on table public.customer from anon, authenticated;
revoke all on table public.tattoo_case from anon, authenticated;
grant select, insert, update on table public.customer to authenticated;
grant select, insert, update on table public.tattoo_case to authenticated;
grant all on table public.customer to service_role;
grant all on table public.tattoo_case to service_role;

create policy customer_owner_all
on public.customer
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));

create policy tattoo_case_owner_all
on public.tattoo_case
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));
