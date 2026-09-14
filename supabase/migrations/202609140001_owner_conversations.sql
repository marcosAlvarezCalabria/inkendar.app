alter table public.tattoo_case
  add constraint tattoo_case_customer_studio_identity_unique unique (id, customer_id, studio_id);

create table public.conversation_link (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  provider text not null check (provider = 'chatwoot'),
  external_account_id text not null check (external_account_id ~ '^[1-9][0-9]*$'),
  external_inbox_id text not null check (external_inbox_id ~ '^[1-9][0-9]*$'),
  external_conversation_id text not null check (external_conversation_id ~ '^[1-9][0-9]*$'),
  customer_id uuid not null,
  tattoo_case_id uuid,
  last_external_message_id text check (last_external_message_id is null or last_external_message_id ~ '^[1-9][0-9]*$'),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_link_customer_same_studio_fk
    foreign key (customer_id, studio_id)
    references public.customer(id, studio_id)
    on delete restrict,
  constraint conversation_link_case_customer_same_studio_fk
    foreign key (tattoo_case_id, customer_id, studio_id)
    references public.tattoo_case(id, customer_id, studio_id)
    on delete restrict
);

create unique index conversation_link_provider_identity_unique
  on public.conversation_link(studio_id, provider, external_account_id, external_conversation_id);
create index conversation_link_studio_customer_idx
  on public.conversation_link(studio_id, customer_id);
create index conversation_link_studio_case_idx
  on public.conversation_link(studio_id, tattoo_case_id)
  where tattoo_case_id is not null;
create index conversation_link_studio_activity_idx
  on public.conversation_link(studio_id, last_activity_at desc nulls last);

create table public.conversation_webhook_receipt (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  provider text not null check (provider = 'chatwoot'),
  delivery_id text not null check (char_length(delivery_id) between 1 and 200),
  event_name text not null check (event_name = 'message_created'),
  external_account_id text not null check (external_account_id ~ '^[1-9][0-9]*$'),
  external_inbox_id text not null check (external_inbox_id ~ '^[1-9][0-9]*$'),
  external_conversation_id text not null check (external_conversation_id ~ '^[1-9][0-9]*$'),
  external_message_id text not null check (external_message_id ~ '^[1-9][0-9]*$'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create unique index conversation_webhook_receipt_delivery_unique
  on public.conversation_webhook_receipt(studio_id, provider, delivery_id);
create index conversation_webhook_receipt_received_idx
  on public.conversation_webhook_receipt(studio_id, received_at desc);

alter table public.conversation_link enable row level security;
alter table public.conversation_webhook_receipt enable row level security;

revoke all on table public.conversation_link from anon, authenticated;
revoke all on table public.conversation_webhook_receipt from anon, authenticated;
grant select, insert, update on table public.conversation_link to authenticated;
grant all on table public.conversation_link to service_role;
grant all on table public.conversation_webhook_receipt to service_role;

create policy conversation_link_owner_all
on public.conversation_link
for all
to authenticated
using (private.is_studio_owner(studio_id))
with check (private.is_studio_owner(studio_id));

create or replace function public.ingest_conversation_webhook(
  p_studio_id uuid,
  p_provider text,
  p_delivery_id text,
  p_event_name text,
  p_external_account_id text,
  p_external_inbox_id text,
  p_external_conversation_id text,
  p_external_message_id text,
  p_occurred_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.conversation_webhook_receipt (
    studio_id,
    provider,
    delivery_id,
    event_name,
    external_account_id,
    external_inbox_id,
    external_conversation_id,
    external_message_id,
    occurred_at
  ) values (
    p_studio_id,
    p_provider,
    p_delivery_id,
    p_event_name,
    p_external_account_id,
    p_external_inbox_id,
    p_external_conversation_id,
    p_external_message_id,
    p_occurred_at
  )
  on conflict (studio_id, provider, delivery_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return 'DUPLICATE';
  end if;

  update public.conversation_link
  set
    external_inbox_id = p_external_inbox_id,
    last_external_message_id = p_external_message_id,
    last_activity_at = p_occurred_at,
    updated_at = now()
  where studio_id = p_studio_id
    and provider = p_provider
    and external_account_id = p_external_account_id
    and external_conversation_id = p_external_conversation_id
    and (
      last_activity_at is null
      or p_occurred_at > last_activity_at
      or (
        p_occurred_at = last_activity_at
        and p_external_message_id::numeric > coalesce(last_external_message_id, '0')::numeric
      )
    );

  return 'ACCEPTED';
end;
$$;

revoke all on function public.ingest_conversation_webhook(uuid, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_conversation_webhook(uuid, text, text, text, text, text, text, text, timestamptz) to service_role;
