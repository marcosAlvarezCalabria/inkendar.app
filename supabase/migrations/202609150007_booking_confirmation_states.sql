alter type public.booking_offer_status add value if not exists 'CONFIRMED';
alter type public.booking_option_status add value if not exists 'CONFIRMED';

create type public.appointment_status as enum ('CONFIRMED');
