alter table public.booking_notification_job
  drop constraint booking_notification_job_external_message_id_check;

alter table public.booking_notification_job
  add constraint booking_notification_external_message_id_safe check (
    external_message_id is null or external_message_id ~ '^[A-Za-z0-9_-]{1,200}$'
  );

drop function public.claim_booking_notification_job(timestamptz, timestamptz);

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

  select
    count(link.id)::integer,
    min(link.external_account_id),
    min(link.external_conversation_id),
    min(customer.email)
  into v_route_count, v_account_id, v_conversation_id, v_customer_email
  from public.booking_offer offer
  join public.tattoo_case tattoo_case
    on tattoo_case.id = offer.tattoo_case_id
   and tattoo_case.studio_id = offer.studio_id
  join public.customer customer
    on customer.id = tattoo_case.customer_id
   and customer.studio_id = tattoo_case.studio_id
  left join public.conversation_link link
    on link.studio_id = tattoo_case.studio_id
   and link.tattoo_case_id = tattoo_case.id
   and link.customer_id = customer.id
   and link.provider = 'chatwoot'
  where offer.id = v_job.booking_offer_id
    and offer.studio_id = v_job.studio_id;

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

create or replace function public.transition_booking_notification_job(
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
    or p_status not in ('SUCCEEDED', 'FAILED', 'UNKNOWN', 'NO_ROUTE')
    or (p_status = 'SUCCEEDED') <> (p_external_message_id is not null)
    or (p_external_message_id is not null and p_external_message_id !~ '^[A-Za-z0-9_-]{1,200}$')
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
  public.claim_booking_notification_job(timestamptz, timestamptz),
  public.transition_booking_notification_job(uuid, uuid, public.booking_notification_status, text, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_booking_notification_job(timestamptz, timestamptz),
  public.transition_booking_notification_job(uuid, uuid, public.booking_notification_status, text, timestamptz, timestamptz)
to service_role;
