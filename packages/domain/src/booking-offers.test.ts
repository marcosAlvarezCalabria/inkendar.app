import { describe, expect, it } from "vitest";

import { InvalidBookingOfferInputError, bookingOfferExpiry, validateBookingOptions } from "./booking-offers.js";

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
});
