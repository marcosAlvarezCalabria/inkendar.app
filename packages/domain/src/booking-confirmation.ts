import type { BusyInterval } from "./availability.js";

export type BookingConfirmationInterval = Readonly<{ startUtc: string; endUtc: string }>;

export class InvalidBookingConfirmationIntervalError extends Error {
  readonly code = "INVALID_BOOKING_CONFIRMATION_INTERVAL";
  constructor() { super("Booking confirmation interval is invalid"); this.name = "InvalidBookingConfirmationIntervalError"; }
}

export function normalizeBookingConfirmationInterval(interval: BookingConfirmationInterval): BookingConfirmationInterval {
  const start = instant(interval.startUtc);
  const end = instant(interval.endUtc);
  if (end <= start) throw new InvalidBookingConfirmationIntervalError();
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() };
}

export function isBookingIntervalFree(selectedValue: BookingConfirmationInterval, busyValues: readonly BusyInterval[]): boolean {
  const selected = normalizeBookingConfirmationInterval(selectedValue);
  return busyValues.every((busyValue) => {
    const busy = normalizeBookingConfirmationInterval(busyValue);
    return busy.endUtc <= selected.startUtc || busy.startUtc >= selected.endUtc;
  });
}

function instant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) throw new InvalidBookingConfirmationIntervalError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new InvalidBookingConfirmationIntervalError();
  return parsed.getTime();
}
