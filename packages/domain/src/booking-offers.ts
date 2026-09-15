import { AVAILABILITY_LIMITS } from "./availability.js";

export type BookingOptionDraft = Readonly<{ startUtc: string; endUtc: string }>;

export const PUBLIC_BOOKING_OFFER_TOKEN_BYTES = 32;

export class InvalidBookingOfferInputError extends Error {
  readonly code = "INVALID_BOOKING_OFFER_INPUT";
  constructor() { super("Booking offer input is invalid"); this.name = "InvalidBookingOfferInputError"; }
}

export class InvalidPublicBookingOfferTokenError extends Error {
  readonly code = "INVALID_PUBLIC_BOOKING_OFFER_TOKEN";
  constructor() { super("Public booking offer token is invalid"); this.name = "InvalidPublicBookingOfferTokenError"; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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

export function encodePublicBookingOfferToken(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== PUBLIC_BOOKING_OFFER_TOKEN_BYTES) invalidPublicToken();
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64URL_ALPHABET[first >>> 2];
    encoded += BASE64URL_ALPHABET[((first & 3) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) encoded += BASE64URL_ALPHABET[((second & 15) << 2) | ((third ?? 0) >>> 6)];
    if (third !== undefined) encoded += BASE64URL_ALPHABET[third & 63];
  }
  return normalizePublicBookingOfferToken(encoded);
}

export function normalizePublicBookingOfferToken(value: string): string {
  if (!PUBLIC_TOKEN_PATTERN.test(value)) invalidPublicToken();
  return value;
}

export function normalizePublicBookingOfferHash(value: string): string {
  if (!SHA_256_HEX_PATTERN.test(value)) invalidPublicToken();
  return value;
}

function parseUtc(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid();
  return date;
}

function invalid(): never { throw new InvalidBookingOfferInputError(); }
function invalidPublicToken(): never { throw new InvalidPublicBookingOfferTokenError(); }
