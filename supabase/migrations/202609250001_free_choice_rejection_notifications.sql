create type public.booking_notification_event_type_v2 as enum ('CONFIRMED', 'EXPIRED', 'REJECTED');

alter table public.booking_notification_job
  alter column event_type type public.booking_notification_event_type_v2
  using event_type::text::public.booking_notification_event_type_v2;

drop type public.booking_notification_event_type;
alter type public.booking_notification_event_type_v2 rename to booking_notification_event_type;

alter table public.free_choice_pending_request
  add constraint free_choice_request_notification_identity_unique unique (id, studio_id);

alter table public.booking_notification_job
  alter column booking_offer_id drop not null,
  add column free_choice_request_id uuid,
  add constraint booking_notification_free_choice_same_tenant_fk
    foreign key (free_choice_request_id, studio_id)
    references public.free_choice_pending_request(id, studio_id)
    on delete restrict,
  add constraint booking_notification_source_xor check (
    (booking_offer_id is not null and free_choice_request_id is null)
    or (booking_offer_id is null and free_choice_request_id is not null)
  ),
  add constraint booking_notification_source_event_check check (
    (booking_offer_id is not null and event_type in ('CONFIRMED', 'EXPIRED'))
    or (free_choice_request_id is not null and event_type = 'REJECTED')
  ),
  add constraint booking_notification_free_choice_event_unique
    unique (studio_id, free_choice_request_id, event_type);

create function private.enqueue_free_choice_rejection_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'REJECTED'
    and new.status is distinct from old.status
  then
    insert into public.booking_notification_job (
      studio_id,
      free_choice_request_id,
      event_type,
      next_attempt_at,
      created_at,
      updated_at
    ) values (
      new.studio_id,
      new.id,
      'REJECTED',
      transaction_timestamp(),
      transaction_timestamp(),
      transaction_timestamp()
    )
    on conflict (studio_id, free_choice_request_id, event_type) do nothing;
  end if;
  return new;
end
$$;

revoke all on function private.enqueue_free_choice_rejection_notification()
from public, anon, authenticated, service_role;

create trigger free_choice_request_enqueue_rejection_notification
after update of status on public.free_choice_pending_request
for each row execute function private.enqueue_free_choice_rejection_notification();

create or replace function public.claim_booking_notification_job(
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
  delivery_channel text,
  external_account_id text,
  external_conversation_id text,
  customer_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.booking_notification_job%rowtype;
  v_lease_id uuid;
  v_tattoo_case_id uuid;
  v_route_count integer;
  v_account_id text;
  v_conversation_id text;
  v_customer_email text;
  v_delivery_channel text;
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
    return query select
      'UNKNOWN'::text, v_job.id, null::uuid, null::text, null::integer,
      null::uuid, null::text, null::text, null::text, null::text;
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

  select coalesce(offer.tattoo_case_id, request.tattoo_case_id)
  into v_tattoo_case_id
  from public.booking_notification_job job
  left join public.booking_offer offer
    on offer.id = job.booking_offer_id
   and offer.studio_id = job.studio_id
  left join public.free_choice_pending_request request
    on request.id = job.free_choice_request_id
   and request.studio_id = job.studio_id
  where job.id = v_job.id;

  select
    count(link.id)::integer,
    min(link.external_account_id),
    min(link.external_conversation_id),
    min(customer.email)
  into v_route_count, v_account_id, v_conversation_id, v_customer_email
  from public.tattoo_case tattoo_case
  join public.customer customer
    on customer.id = tattoo_case.customer_id
   and customer.studio_id = tattoo_case.studio_id
  left join public.conversation_link link
    on link.studio_id = tattoo_case.studio_id
   and link.tattoo_case_id = tattoo_case.id
   and link.customer_id = customer.id
   and link.provider = 'chatwoot'
  where tattoo_case.id = v_tattoo_case_id
    and tattoo_case.studio_id = v_job.studio_id;

  if v_route_count = 1 then
    v_delivery_channel := 'CHATWOOT';
    v_customer_email := null;
  elsif v_customer_email is not null then
    v_delivery_channel := 'EMAIL';
    v_account_id := null;
    v_conversation_id := null;
  else
    update public.booking_notification_job
    set status = 'NO_ROUTE', updated_at = p_now
    where id = v_job.id;
    return query select
      'NO_ROUTE'::text, v_job.id, null::uuid, null::text, null::integer,
      null::uuid, null::text, null::text, null::text, null::text;
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
    v_delivery_channel,
    v_account_id,
    v_conversation_id,
    v_customer_email;
end
$$;

revoke all on function public.claim_booking_notification_job(timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.claim_booking_notification_job(timestamptz, timestamptz)
to service_role;
