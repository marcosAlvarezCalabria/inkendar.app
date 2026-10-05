create table public.conversation_webhook_attempt (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studio(id) on delete restrict,
  provider text not null check (provider = 'chatwoot'),
  outcome text not null check (outcome in (
    'request_invalid',
    'auth_headers_missing',
    'auth_invalid',
    'signature_invalid',
    'schema_invalid',
    'persistence_failed',
    'accepted',
    'duplicate'
  )),
  received_at timestamptz not null default now()
);

create index conversation_webhook_attempt_studio_received_idx
  on public.conversation_webhook_attempt(studio_id, received_at desc);

alter table public.conversation_webhook_attempt enable row level security;

revoke all on table public.conversation_webhook_attempt from public, anon, authenticated;
revoke all on sequence public.conversation_webhook_attempt_id_seq from public, anon, authenticated;
grant all on table public.conversation_webhook_attempt to service_role;
grant all on sequence public.conversation_webhook_attempt_id_seq to service_role;

create or replace function public.record_conversation_webhook_attempt(
  p_studio_id uuid,
  p_provider text,
  p_outcome text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.conversation_webhook_attempt (studio_id, provider, outcome)
  values (p_studio_id, p_provider, p_outcome);
$$;

revoke all on function public.record_conversation_webhook_attempt(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_conversation_webhook_attempt(uuid, text, text) to service_role;

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
    insert into public.conversation_webhook_attempt (studio_id, provider, outcome)
    values (p_studio_id, p_provider, 'duplicate');
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

  insert into public.conversation_webhook_attempt (studio_id, provider, outcome)
  values (p_studio_id, p_provider, 'accepted');

  return 'ACCEPTED';
end;
$$;

revoke all on function public.ingest_conversation_webhook(uuid, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_conversation_webhook(uuid, text, text, text, text, text, text, text, timestamptz) to service_role;
