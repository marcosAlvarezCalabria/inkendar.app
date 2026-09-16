create type public.booking_notification_event_type as enum ('CONFIRMED', 'EXPIRED');
create type public.booking_notification_status as enum ('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'NO_ROUTE');

alter table public.booking_offer
  add constraint booking_offer_notification_identity_unique unique (id, studio_id);

create table public.booking_notification_job (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studio(id) on delete restrict,
  booking_offer_id uuid not null,
  event_type public.booking_notification_event_type not null,
  status public.booking_notification_status not null default 'PENDING',
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  external_message_id text check (external_message_id is null or external_message_id ~ '^[1-9][0-9]*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_notification_offer_same_tenant_fk
    foreign key (booking_offer_id, studio_id) references public.booking_offer(id, studio_id) on delete restrict,
  constraint booking_notification_event_unique unique (studio_id, booking_offer_id, event_type),
  constraint booking_notification_lease_pair check (
    (status = 'LEASED') = (lease_id is not null and lease_expires_at is not null)
  ),
  constraint booking_notification_success_message check (
    (status = 'SUCCEEDED') = (external_message_id is not null)
  )
);

create index booking_notification_claim_idx
  on public.booking_notification_job(next_attempt_at, created_at, id)
  where status in ('PENDING', 'FAILED');
create index booking_notification_expired_lease_idx
  on public.booking_notification_job(lease_expires_at, id)
  where status = 'LEASED';

alter table public.booking_notification_job enable row level security;
revoke all on table public.booking_notification_job from public, anon, authenticated, service_role;

create function private.enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('CONFIRMED', 'EXPIRED')
    and new.status is distinct from old.status
  then
    insert into public.booking_notification_job (
      studio_id, booking_offer_id, event_type, next_attempt_at, created_at, updated_at
    ) values (
      new.studio_id,
      new.id,
      new.status::text::public.booking_notification_event_type,
      new.updated_at,
      new.updated_at,
      new.updated_at
    )
    on conflict (studio_id, booking_offer_id, event_type) do nothing;
  end if;
  return new;
end
$$;

revoke all on function private.enqueue_booking_notification() from public, anon, authenticated, service_role;

create trigger booking_offer_enqueue_notification
after update of status on public.booking_offer
for each row execute function private.enqueue_booking_notification();

create function public.materialize_due_booking_expirations(
  p_now timestamptz,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.booking_offer%rowtype;
  v_operation_state text;
  v_count integer := 0;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid booking expiry batch' using errcode = '22023';
  end if;

  for v_offer in
    select offer.*
    from public.booking_offer offer
    where offer.status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
      and offer.expires_at <= p_now
      and not exists (
        select 1
        from public.booking_confirmation_operation operation
        where operation.booking_offer_id = offer.id
          and operation.studio_id = offer.studio_id
          and operation.state = 'INSERTING'
      )
    order by offer.expires_at, offer.id
    for update of offer skip locked
    limit p_limit
  loop
    v_operation_state := null;
    select operation.state::text into v_operation_state
    from public.booking_confirmation_operation operation
    where operation.booking_offer_id = v_offer.id
      and operation.studio_id = v_offer.studio_id
    for update of operation;

    if v_operation_state = 'INSERTING' then
      continue;
    end if;

    update public.booking_offer
    set status = 'EXPIRED', updated_at = p_now
    where id = v_offer.id
      and studio_id = v_offer.studio_id
      and status in ('OPEN', 'SELECTED_PENDING_CONFIRMATION')
      and expires_at <= p_now;

    if found then
      update public.booking_option
      set status = 'RELEASED'
      where offer_id = v_offer.id
        and studio_id = v_offer.studio_id
        and status in ('HELD', 'SELECTED');
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end
$$;

create function public.claim_booking_notification_job(
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns table (
  claim_status text,
  job_id uuid,
  studio_id uuid,
  event_type text,
  attempt_count integer,
  lease_id uuid,
  external_account_id text,
  external_conversation_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.booking_notification_job%rowtype;
  v_lease_id uuid;
  v_route_count integer;
  v_account_id text;
  v_conversation_id text;
begin
  if p_now is null or p_lease_expires_at is null
    or p_lease_expires_at <= p_now
    or p_lease_expires_at > p_now + interval '5 minutes'
  then
    raise exception 'invalid notification lease' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.booking_notification_job job
  where job.status = 'LEASED'
    and job.lease_expires_at <= p_now
  order by job.lease_expires_at, job.id
  for update of job skip locked
  limit 1;

  if found then
    update public.booking_notification_job
    set status = 'UNKNOWN', lease_id = null, lease_expires_at = null, updated_at = p_now
    where id = v_job.id;
    return query select 'UNKNOWN'::text, v_job.id, null::uuid, null::text, null::integer, null::uuid, null::text, null::text;
    return;
  end if;

  select job.* into v_job
  from public.booking_notification_job job
  where job.status in ('PENDING', 'FAILED')
    and job.next_attempt_at <= p_now
    and job.attempt_count < 3
  order by job.next_attempt_at, job.created_at, job.id
  for update of job skip locked
  limit 1;

  if not found then
    return;
  end if;

  select count(*)::integer, min(link.external_account_id), min(link.external_conversation_id)
  into v_route_count, v_account_id, v_conversation_id
  from public.booking_offer offer
  join public.conversation_link link
    on link.studio_id = offer.studio_id
   and link.tattoo_case_id = offer.tattoo_case_id
   and link.provider = 'chatwoot'
  where offer.id = v_job.booking_offer_id
    and offer.studio_id = v_job.studio_id;

  if v_route_count <> 1 then
    update public.booking_notification_job
    set status = 'NO_ROUTE', updated_at = p_now
    where id = v_job.id;
    return query select 'NO_ROUTE'::text, v_job.id, null::uuid, null::text, null::integer, null::uuid, null::text, null::text;
    return;
  end if;

  v_lease_id := gen_random_uuid();
  update public.booking_notification_job
  set status = 'LEASED',
      attempt_count = public.booking_notification_job.attempt_count + 1,
      lease_id = v_lease_id,
      lease_expires_at = p_lease_expires_at,
      updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  return query select
    'CLAIMED'::text,
    v_job.id,
    v_job.studio_id,
    v_job.event_type::text,
    v_job.attempt_count::integer,
    v_lease_id,
    v_account_id,
    v_conversation_id;
end
$$;

create function public.transition_booking_notification_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_status public.booking_notification_status,
  p_external_message_id text,
  p_next_attempt_at timestamptz,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job_id is null or p_lease_id is null or p_now is null
    or p_status not in ('SUCCEEDED', 'FAILED', 'UNKNOWN')
    or (p_status = 'SUCCEEDED') <> (p_external_message_id is not null)
    or (p_external_message_id is not null and p_external_message_id !~ '^[1-9][0-9]*$')
    or (p_status = 'FAILED') <> (p_next_attempt_at is not null)
    or (p_next_attempt_at is not null and p_next_attempt_at <= p_now)
  then
    raise exception 'invalid notification transition' using errcode = '22023';
  end if;

  update public.booking_notification_job
  set status = p_status,
      external_message_id = p_external_message_id,
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
      lease_id = null,
      lease_expires_at = null,
      updated_at = p_now
  where id = p_job_id
    and status = 'LEASED'
    and lease_id = p_lease_id
    and lease_expires_at > p_now;

  if not found then
    raise exception 'notification lease unavailable' using errcode = '23514';
  end if;
end
$$;

revoke all on function
  public.materialize_due_booking_expirations(timestamptz, integer),
  public.claim_booking_notification_job(timestamptz, timestamptz),
  public.transition_booking_notification_job(uuid, uuid, public.booking_notification_status, text, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.materialize_due_booking_expirations(timestamptz, integer),
  public.claim_booking_notification_job(timestamptz, timestamptz),
  public.transition_booking_notification_job(uuid, uuid, public.booking_notification_status, text, timestamptz, timestamptz)
to service_role;
