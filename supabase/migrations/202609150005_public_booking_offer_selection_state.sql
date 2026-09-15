alter type public.booking_offer_status add value if not exists 'SELECTED_PENDING_CONFIRMATION';
alter type public.booking_option_status add value if not exists 'SELECTED';

alter table public.booking_option
  add column public_selector uuid not null default gen_random_uuid();

alter table public.booking_option
  add constraint booking_option_public_selector_unique unique (public_selector);
