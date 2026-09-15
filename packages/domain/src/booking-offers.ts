import { AVAILABILITY_LIMITS } from "./availability.js";

export type BookingOptionDraft = Readonly<{ startUtc: string; endUtc: string }>;

export class InvalidBookingOfferInputError extends Error {
  readonly code = "INVALID_BOOKING_OFFER_INPUT";
  constructor() { super("Booking offer input is invalid"); this.name = "InvalidBookingOfferInputError"; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeBookingResourceId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) invalid();
  return normalized;
}

export function validateBookingExpiryHours(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 32_767) invalid();
  return value;
}

export function bookingOfferExpiry(nowUtc: string, expiryHours: number): string {
  const now = parseUtc(nowUtc);
  const expiry = now.getTime() + validateBookingExpiryHours(expiryHours) * 3_600_000;
  if (!Number.isFinite(expiry)) invalid();
  return new Date(expiry).toISOString();
}

export function validateBookingOptions(options: readonly BookingOptionDraft[], nowUtc: string): readonly BookingOptionDraft[] {
  const now = parseUtc(nowUtc).getTime();
  if (options.length < 1 || options.length > 3) invalid();
  const normalized = options.map((option) => {
    const start = parseUtc(option.startUtc).getTime();
    const end = parseUtc(option.endUtc).getTime();
    const duration = (end - start) / 60_000;
    if (start <= now || !Number.isInteger(duration) || duration < AVAILABILITY_LIMITS.minDurationMinutes || duration > AVAILABILITY_LIMITS.maxDurationMinutes) invalid();
    return { startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() };
  }).sort((left, right) => left.startUtc.localeCompare(right.startUtc));
  for (let index = 1; index < normalized.length; index += 1) if (normalized[index]!.startUtc < normalized[index - 1]!.endUtc) invalid();
  return normalized;
}

function parseUtc(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid();
  return date;
}

function invalid(): never { throw new InvalidBookingOfferInputError(); }
