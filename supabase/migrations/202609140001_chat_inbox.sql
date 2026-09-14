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
grant select on table public.integration_connection to authenticated;
grant select, insert, update on table public.conversation_link to authenticated;
grant select, insert, update on table public.outbound_message_operation to authenticated;
grant all on table public.integration_connection, public.conversation_link, public.outbound_message_operation to service_role;

create policy integration_connection_owner_select on public.integration_connection for select to authenticated using (private.is_studio_owner(studio_id));
create policy conversation_link_owner_all on public.conversation_link for all to authenticated using (private.is_studio_owner(studio_id)) with check (private.is_studio_owner(studio_id));
create policy outbound_message_owner_all on public.outbound_message_operation for all to authenticated using (private.is_studio_owner(studio_id)) with check (private.is_studio_owner(studio_id));

create or replace function public.claim_outbound_message_operation(
  p_studio_id uuid, p_conversation_link_id uuid, p_idempotency_key uuid
) returns table (claim_status text, operation_id uuid, external_message_id bigint)
language plpgsql
set search_path = ''
as $$
declare
  claimed public.outbound_message_operation%rowtype;
begin
  insert into public.outbound_message_operation (studio_id, conversation_link_id, idempotency_key)
  values (p_studio_id, p_conversation_link_id, p_idempotency_key)
  on conflict (studio_id, idempotency_key) do nothing
  returning * into claimed;

  if claimed.id is not null then
    return query select 'CLAIMED'::text, claimed.id, null::bigint;
    return;
  end if;

  update public.outbound_message_operation
  set status = 'PENDING', updated_at = now()
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key
    and conversation_link_id = p_conversation_link_id and status = 'FAILED'
  returning * into claimed;

  if claimed.id is not null then
    return query select 'CLAIMED'::text, claimed.id, null::bigint;
    return;
  end if;

  select * into claimed from public.outbound_message_operation
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key and conversation_link_id = p_conversation_link_id;
  if claimed.id is null then raise insufficient_privilege using message = 'outbound operation unavailable'; end if;
  return query select claimed.status::text, claimed.id, claimed.external_message_id;
end;
$$;
revoke all on function public.claim_outbound_message_operation(uuid, uuid, uuid) from public, anon;
grant execute on function public.claim_outbound_message_operation(uuid, uuid, uuid) to authenticated, service_role;
