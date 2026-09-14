create type public.integration_connection_status as enum ('ACTIVE', 'DISABLED');
create type public.outbound_message_status as enum ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

create table public.integration_connection (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  external_account_id bigint not null check (external_account_id > 0),
  credential_reference text not null check (credential_reference = btrim(credential_reference) and char_length(credential_reference) between 1 and 120),
  status public.integration_connection_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connection_identity_unique unique (id, studio_id)
);
create unique index integration_connection_active_studio_unique on public.integration_connection(studio_id) where status = 'ACTIVE';

create table public.conversation_link (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  integration_connection_id uuid not null,
  external_conversation_id bigint not null check (external_conversation_id > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_link_connection_same_studio_fk foreign key (integration_connection_id, studio_id)
    references public.integration_connection(id, studio_id) on delete restrict,
  constraint conversation_link_identity_unique unique (id, studio_id),
  constraint conversation_link_external_unique unique (integration_connection_id, external_conversation_id)
);
create index conversation_link_studio_external_idx on public.conversation_link(studio_id, external_conversation_id);

create table public.outbound_message_operation (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  conversation_link_id uuid not null,
  idempotency_key uuid not null,
  status public.outbound_message_status not null default 'PENDING',
  external_message_id bigint check (external_message_id is null or external_message_id > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_message_conversation_same_studio_fk foreign key (conversation_link_id, studio_id)
    references public.conversation_link(id, studio_id) on delete restrict,
  constraint outbound_message_idempotency_unique unique (studio_id, idempotency_key),
  constraint outbound_message_success_has_id check ((status = 'SUCCEEDED') = (external_message_id is not null))
);
create index outbound_message_conversation_idx on public.outbound_message_operation(studio_id, conversation_link_id);

alter table public.integration_connection enable row level security;
alter table public.conversation_link enable row level security;
alter table public.outbound_message_operation enable row level security;

revoke all on table public.integration_connection, public.conversation_link, public.outbound_message_operation from anon, authenticated;
grant select on table public.integration_connection, public.conversation_link, public.outbound_message_operation to authenticated;
grant all on table public.integration_connection, public.conversation_link, public.outbound_message_operation to service_role;

create policy integration_connection_owner_select on public.integration_connection for select to authenticated using (private.is_studio_owner(studio_id));
create policy conversation_link_owner_select on public.conversation_link for select to authenticated using (private.is_studio_owner(studio_id));
create policy outbound_message_owner_select on public.outbound_message_operation for select to authenticated using (private.is_studio_owner(studio_id));

create or replace function public.upsert_conversation_links(
  p_studio_id uuid, p_integration_connection_id uuid, p_external_conversation_ids bigint[]
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.integration_connection
    where id = p_integration_connection_id and studio_id = p_studio_id and status = 'ACTIVE'
  ) then raise insufficient_privilege using message = 'messaging connection unavailable'; end if;

  insert into public.conversation_link (studio_id, integration_connection_id, external_conversation_id)
  select p_studio_id, p_integration_connection_id, external_id
  from unnest(p_external_conversation_ids) as external_id
  on conflict (integration_connection_id, external_conversation_id) do nothing;
end;
$$;

create or replace function public.claim_outbound_message_operation(
  p_studio_id uuid, p_integration_connection_id uuid, p_external_conversation_id bigint, p_idempotency_key uuid
) returns table (claim_status text, operation_id uuid, external_message_id bigint)
language plpgsql security definer
set search_path = ''
as $$
declare
  link_id uuid;
  claimed public.outbound_message_operation%rowtype;
begin
  if not exists (
    select 1 from public.integration_connection
    where id = p_integration_connection_id and studio_id = p_studio_id and status = 'ACTIVE'
  ) then raise insufficient_privilege using message = 'messaging connection unavailable'; end if;

  insert into public.conversation_link (studio_id, integration_connection_id, external_conversation_id)
  values (p_studio_id, p_integration_connection_id, p_external_conversation_id)
  on conflict (integration_connection_id, external_conversation_id) do nothing;

  select id into link_id from public.conversation_link
  where studio_id = p_studio_id and integration_connection_id = p_integration_connection_id
    and external_conversation_id = p_external_conversation_id
  for share;
  if link_id is null then raise insufficient_privilege using message = 'conversation unavailable'; end if;

  insert into public.outbound_message_operation (studio_id, conversation_link_id, idempotency_key)
  values (p_studio_id, link_id, p_idempotency_key)
  on conflict (studio_id, idempotency_key) do nothing
  returning * into claimed;

  if claimed.id is not null then
    return query select 'CLAIMED'::text, claimed.id, null::bigint;
    return;
  end if;

  select * into claimed from public.outbound_message_operation
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key
  for update;
  if claimed.id is null or claimed.conversation_link_id <> link_id then
    raise insufficient_privilege using message = 'outbound operation unavailable';
  end if;
  return query select claimed.status::text, claimed.id, claimed.external_message_id;
end;
$$;

create or replace function public.transition_outbound_message_operation(
  p_studio_id uuid, p_operation_id uuid, p_status public.outbound_message_status, p_external_message_id bigint default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('SUCCEEDED', 'FAILED', 'UNKNOWN')
    or (p_status = 'SUCCEEDED') <> (p_external_message_id is not null)
  then raise check_violation using message = 'invalid outbound transition'; end if;

  update public.outbound_message_operation
  set status = p_status, external_message_id = p_external_message_id, updated_at = now()
  where id = p_operation_id and studio_id = p_studio_id and status = 'PENDING';
  if not found then raise check_violation using message = 'outbound operation is not pending'; end if;
end;
$$;

revoke all on function public.upsert_conversation_links(uuid, uuid, bigint[]) from public, anon, authenticated;
revoke all on function public.claim_outbound_message_operation(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.transition_outbound_message_operation(uuid, uuid, public.outbound_message_status, bigint) from public, anon, authenticated;
grant execute on function public.upsert_conversation_links(uuid, uuid, bigint[]) to service_role;
grant execute on function public.claim_outbound_message_operation(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.transition_outbound_message_operation(uuid, uuid, public.outbound_message_status, bigint) to service_role;
