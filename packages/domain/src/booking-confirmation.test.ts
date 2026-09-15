import { describe, expect, it } from "vitest";

import { InvalidBookingConfirmationIntervalError, isBookingIntervalFree, normalizeBookingConfirmationInterval } from "./booking-confirmation.js";

const selected = { startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" };

describe("booking confirmation interval", () => {
  it("normalizes a positive canonical UTC interval", () => {
    expect(normalizeBookingConfirmationInterval(selected)).toEqual(selected);
  });

  it.each([
    { startUtc: "invalid", endUtc: selected.endUtc },
    { startUtc: selected.startUtc, endUtc: selected.startUtc },
    { startUtc: selected.endUtc, endUtc: selected.startUtc },
  ])("rejects malformed or non-positive intervals", (interval) => {
    expect(() => normalizeBookingConfirmationInterval(interval)).toThrow(InvalidBookingConfirmationIntervalError);
  });

  it("treats intervals as [start,end), accepting adjacency but rejecting any overlap", () => {
    expect(isBookingIntervalFree(selected, [
      { startUtc: "2026-09-20T08:00:00.000Z", endUtc: selected.startUtc },
      { startUtc: selected.endUtc, endUtc: "2026-09-20T11:00:00.000Z" },
    ])).toBe(true);
    expect(isBookingIntervalFree(selected, [
      { startUtc: "2026-09-20T09:59:59.999Z", endUtc: "2026-09-20T11:00:00.000Z" },
    ])).toBe(false);
  });
});
