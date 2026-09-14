create type public.conversation_outbound_status as enum ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

create table public.conversation_outbound_operation (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  provider text not null check (provider = 'chatwoot'),
  external_account_id text not null check (external_account_id ~ '^[1-9][0-9]*$'),
  external_conversation_id text not null check (external_conversation_id ~ '^[1-9][0-9]*$'),
  idempotency_key uuid not null,
  status public.conversation_outbound_status not null default 'PENDING',
  external_message_id text check (external_message_id is null or external_message_id ~ '^[1-9][0-9]*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_outbound_idempotency_unique unique (studio_id, idempotency_key),
  constraint conversation_outbound_success_has_message check ((status = 'SUCCEEDED') = (external_message_id is not null))
);

create index conversation_outbound_conversation_idx
  on public.conversation_outbound_operation(studio_id, provider, external_account_id, external_conversation_id);

alter table public.conversation_outbound_operation enable row level security;
revoke all on table public.conversation_outbound_operation from anon, authenticated;
grant select on table public.conversation_outbound_operation to authenticated;
grant all on table public.conversation_outbound_operation to service_role;

create policy conversation_outbound_owner_select
on public.conversation_outbound_operation
for select to authenticated
using (private.is_studio_owner(studio_id));

create or replace function public.claim_conversation_outbound_operation(
  p_studio_id uuid,
  p_provider text,
  p_external_account_id text,
  p_external_conversation_id text,
  p_idempotency_key uuid
)
returns table (claim_status text, operation_id uuid, external_message_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.conversation_outbound_operation%rowtype;
begin
  if p_provider <> 'chatwoot'
    or p_external_account_id !~ '^[1-9][0-9]*$'
    or p_external_conversation_id !~ '^[1-9][0-9]*$'
  then
    raise check_violation using message = 'invalid outbound operation';
  end if;

  insert into public.conversation_outbound_operation (
    studio_id, provider, external_account_id, external_conversation_id, idempotency_key
  ) values (
    p_studio_id, p_provider, p_external_account_id, p_external_conversation_id, p_idempotency_key
  )
  on conflict (studio_id, idempotency_key) do nothing
  returning * into claimed;

  if claimed.id is not null then
    return query select 'CLAIMED'::text, claimed.id, null::text;
    return;
  end if;

  select * into claimed
  from public.conversation_outbound_operation
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key
  for update;

  if claimed.id is null
    or claimed.provider <> p_provider
    or claimed.external_account_id <> p_external_account_id
    or claimed.external_conversation_id <> p_external_conversation_id
  then
    raise insufficient_privilege using message = 'outbound operation unavailable';
  end if;

  return query select claimed.status::text, claimed.id, claimed.external_message_id;
end;
$$;

create or replace function public.transition_conversation_outbound_operation(
  p_studio_id uuid,
  p_operation_id uuid,
  p_status public.conversation_outbound_status,
  p_external_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('SUCCEEDED', 'FAILED', 'UNKNOWN')
    or (p_status = 'SUCCEEDED') <> (p_external_message_id is not null)
    or (p_external_message_id is not null and p_external_message_id !~ '^[1-9][0-9]*$')
  then
    raise check_violation using message = 'invalid outbound transition';
  end if;

  update public.conversation_outbound_operation
  set status = p_status, external_message_id = p_external_message_id, updated_at = now()
  where id = p_operation_id and studio_id = p_studio_id and status = 'PENDING';

  if not found then
    raise check_violation using message = 'outbound operation is not pending';
  end if;
end;
$$;

revoke all on function public.claim_conversation_outbound_operation(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.transition_conversation_outbound_operation(uuid, uuid, public.conversation_outbound_status, text) from public, anon, authenticated;
grant execute on function public.claim_conversation_outbound_operation(uuid, text, text, text, uuid) to service_role;
grant execute on function public.transition_conversation_outbound_operation(uuid, uuid, public.conversation_outbound_status, text) to service_role;
