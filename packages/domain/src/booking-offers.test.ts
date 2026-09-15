import { describe, expect, it } from "vitest";

import {
  InvalidBookingOfferInputError,
  InvalidPublicBookingOptionSelectorError,
  InvalidPublicBookingOfferTokenError,
  PUBLIC_BOOKING_OFFER_TOKEN_BYTES,
  bookingOfferExpiry,
  encodePublicBookingOfferToken,
  normalizePublicBookingOfferHash,
  normalizePublicBookingOptionSelector,
  normalizePublicBookingOfferToken,
  validateBookingOptions,
} from "./booking-offers.js";

describe("booking offer domain", () => {
  const now = "2026-09-15T10:00:00.000Z";

  it("accepts one to three future UTC options and calculates the configured expiry", () => {
    expect(validateBookingOptions([{ startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T10:00:00.000Z" }], now)).toHaveLength(1);
    expect(bookingOfferExpiry(now, 24)).toBe("2026-09-16T10:00:00.000Z");
  });

  it.each([
    { options: [] },
    { options: [1, 2, 3, 4].map((hour) => ({ startUtc: `2026-09-16T0${hour}:00:00.000Z`, endUtc: `2026-09-16T0${hour}:30:00.000Z` })) },
    { options: [{ startUtc: "2026-09-15T09:00:00.000Z", endUtc: "2026-09-15T10:00:00.000Z" }] },
    { options: [{ startUtc: "2026-09-16T09:00:00+01:00", endUtc: "2026-09-16T10:00:00+01:00" }] },
    { options: [{ startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T17:01:00.000Z" }] },
  ])("rejects invalid option sets", ({ options }) => {
    expect(() => validateBookingOptions(options, now)).toThrow(InvalidBookingOfferInputError);
  });

  it("rejects overlapping options and non-positive expiry hours", () => {
    expect(() => validateBookingOptions([
      { startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T10:00:00.000Z" },
      { startUtc: "2026-09-16T09:30:00.000Z", endUtc: "2026-09-16T10:30:00.000Z" },
    ], now)).toThrow(InvalidBookingOfferInputError);
    expect(() => bookingOfferExpiry(now, 0)).toThrow(InvalidBookingOfferInputError);
  });

  it("encodes exactly 256 random bits as one canonical opaque path token", () => {
    const bytes = Uint8Array.from({ length: PUBLIC_BOOKING_OFFER_TOKEN_BYTES }, (_, index) => index);
    const token = encodePublicBookingOfferToken(bytes);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(normalizePublicBookingOfferToken(token)).toBe(token);
  });

  it.each([
    "",
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}=`,
    `${"a".repeat(42)}+`,
    ` ${"a".repeat(43)}`,
    `${"a".repeat(43)}\n`,
    `${"a".repeat(42)}B`,
  ])("rejects non-canonical public access tokens", (token) => {
    expect(() => normalizePublicBookingOfferToken(token)).toThrow(InvalidPublicBookingOfferTokenError);
  });

  it("accepts only a canonical lowercase SHA-256 hash at the persistence boundary", () => {
    const hash = "ab".repeat(32);
    expect(normalizePublicBookingOfferHash(hash)).toBe(hash);
    expect(() => normalizePublicBookingOfferHash(hash.toUpperCase())).toThrow(InvalidPublicBookingOfferTokenError);
    expect(() => normalizePublicBookingOfferHash("a".repeat(63))).toThrow(InvalidPublicBookingOfferTokenError);
  });

  it("accepts only a canonical lowercase UUID v4 public option selector", () => {
    const selector = "a0000000-0000-4000-8000-000000000001";
    expect(normalizePublicBookingOptionSelector(selector)).toBe(selector);
  });

  it.each([
    "90000000-0000-0000-0000-000000000001",
    "A0000000-0000-4000-8000-000000000001",
    "a0000000-0000-3000-8000-000000000001",
    "a0000000-0000-4000-7000-000000000001",
    " a0000000-0000-4000-8000-000000000001",
  ])("rejects internal-looking or non-canonical public option selectors", (selector) => {
    expect(() => normalizePublicBookingOptionSelector(selector)).toThrow(InvalidPublicBookingOptionSelectorError);
  });
});
