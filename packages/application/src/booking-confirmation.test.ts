import { describe, expect, it, vi } from "vitest";

import {
  BookingConfirmationConflictError,
  BookingConfirmationCredentialInvalidError,
  BookingConfirmationMismatchError,
  BookingConfirmationProviderUnavailableError,
  BookingConfirmationReconnectRequiredError,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  createBookingConfirmationService,
  type BookingCalendarEvent,
  type BookingConfirmationRepositoryPort,
  type GoogleBookingEventPort,
} from "./booking-confirmation.js";
import { GOOGLE_FREE_BUSY_SCOPE, type GoogleFreeBusyPort } from "./availability.js";
import type { GoogleTokenProtectorPort } from "./google-calendar.js";

const token = "A".repeat(43), tokenHash = "ab".repeat(32);
const now = "2026-09-15T10:00:00.000Z";
const interval = { startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" };
const identity = { eventId: "inkendar0123456789abcdefghijklmnopqrstuv", correlation: "opaque-correlation" };
const context = {
  state: "PENDING" as const,
  studioId: "20000000-0000-4000-8000-000000000001",
  optionId: "91000000-0000-4000-8000-000000000001",
  ...interval,
  calendarId: "artist@example.test",
  connection: { id: "81000000-0000-4000-8000-000000000001", status: "ACTIVE" as const, encryptedRefreshToken: "cipher", grantedScopes: [GOOGLE_FREE_BUSY_SCOPE, GOOGLE_CALENDAR_EVENTS_SCOPE] },
  finalized: null,
};
const matchingEvent: BookingCalendarEvent = { id: identity.eventId, ...interval, status: "confirmed", summary: "Cita Inkendar", transparency: "opaque", visibility: "private", correlation: identity.correlation, attendeeCount: 0 };

function dependencies(overrides: Partial<Parameters<typeof createBookingConfirmationService>[0]> = {}) {
  const order: string[] = [];
  const repository: BookingConfirmationRepositoryPort = {
    getContext: vi.fn(async () => context),
    finalize: vi.fn(async () => { order.push("finalize"); return { confirmedAt: now }; }),
    markReauthRequired: vi.fn(async () => undefined),
  };
  const events: GoogleBookingEventPort = {
    getEvent: vi.fn(async () => { order.push("get"); return null; }),
    insertEvent: vi.fn(async () => { order.push("insert"); return matchingEvent; }),
  };
  const freeBusy: GoogleFreeBusyPort = { queryBusy: vi.fn(async () => { order.push("freebusy"); return []; }) };
  const tokens: GoogleTokenProtectorPort = { encrypt: vi.fn(), decrypt: vi.fn(() => "refresh") };
  return { order, repository, events, freeBusy, tokens, identity: { create: vi.fn(() => identity) }, hashToken: vi.fn(() => tokenHash), clock: () => new Date(now), ...overrides };
}

describe("public booking confirmation", () => {
  it("reconciles with Events.get first and finalizes an existing exact event without FreeBusy or insert", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.getEvent).mockImplementationOnce(async () => { deps.order.push("get"); return matchingEvent; });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toEqual({ state: "CONFIRMED", confirmedAt: now });
    expect(deps.order).toEqual(["get", "finalize"]);
    expect(deps.repository.finalize).toHaveBeenCalledWith({ tokenHash, connectionId: context.connection.id, calendarId: context.calendarId, eventId: identity.eventId, correlation: identity.correlation, nowUtc: now });
  });

  it("revalidates exactly the selected interval then inserts the minimal private opaque event", async () => {
    const deps = dependencies();
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toMatchObject({ state: "CONFIRMED" });
    expect(deps.order).toEqual(["get", "freebusy", "insert", "finalize"]);
    expect(deps.freeBusy.queryBusy).toHaveBeenCalledWith("refresh", { calendarId: context.calendarId, timeMin: interval.startUtc, timeMax: interval.endUtc });
    expect(deps.events.insertEvent).toHaveBeenCalledWith("refresh", { calendarId: context.calendarId, eventId: identity.eventId, correlation: identity.correlation, ...interval, summary: "Cita Inkendar" });
    expect(JSON.stringify(vi.mocked(deps.events.insertEvent).mock.calls)).not.toMatch(/customer|case|attendee|description/iu);
  });

  it("does not insert or finalize when any FreeBusy interval overlaps the selection", async () => {
    const deps = dependencies();
    vi.mocked(deps.freeBusy.queryBusy).mockResolvedValueOnce([{ startUtc: interval.startUtc, endUtc: interval.endUtc }]);
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationConflictError);
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
    expect(deps.repository.finalize).not.toHaveBeenCalled();
  });

  it("reconciles a matching event after an ambiguous insert response and converges without a second ID", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.insertEvent).mockImplementationOnce(async () => { deps.order.push("insert"); throw new BookingConfirmationProviderUnavailableError(); });
    vi.mocked(deps.events.getEvent).mockImplementationOnce(async () => { deps.order.push("get"); return null; })
      .mockImplementationOnce(async () => { deps.order.push("get-after-insert"); return matchingEvent; });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toMatchObject({ state: "CONFIRMED" });
    expect(deps.order).toEqual(["get", "freebusy", "insert", "get-after-insert", "finalize"]);
    expect(deps.identity.create).toHaveBeenCalledTimes(1);
  });

  it("makes concurrent attempts converge on one deterministic provider identity", async () => {
    const deps = dependencies();
    let getCount = 0;
    vi.mocked(deps.events.getEvent).mockImplementation(async () => {
      getCount += 1;
      return getCount <= 2 ? null : matchingEvent;
    });
    let insertCount = 0;
    vi.mocked(deps.events.insertEvent).mockImplementation(async () => {
      insertCount += 1;
      if (insertCount === 1) return matchingEvent;
      throw new BookingConfirmationProviderUnavailableError();
    });

    const results = await Promise.all([createBookingConfirmationService(deps).confirmPublic(token), createBookingConfirmationService(deps).confirmPublic(token)]);

    expect(results).toEqual([{ state: "CONFIRMED", confirmedAt: now }, { state: "CONFIRMED", confirmedAt: now }]);
    expect(new Set(vi.mocked(deps.events.insertEvent).mock.calls.map((call) => call[1].eventId))).toEqual(new Set([identity.eventId]));
    expect(deps.repository.finalize).toHaveBeenCalledTimes(2);
  });
  it("fails closed on an existing mismatched event and never queries or replaces it", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.getEvent).mockResolvedValueOnce({ ...matchingEvent, correlation: "collision" });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationMismatchError);
    expect(deps.freeBusy.queryBusy).not.toHaveBeenCalled();
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
    expect(deps.repository.finalize).not.toHaveBeenCalled();
  });

  it("preserves pending selection and requires reconnect before provider calls for an old grant", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getContext).mockResolvedValueOnce({ ...context, connection: { ...context.connection, grantedScopes: [GOOGLE_FREE_BUSY_SCOPE] } });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationReconnectRequiredError);
    expect(deps.events.getEvent).not.toHaveBeenCalled();
    expect(deps.repository.finalize).not.toHaveBeenCalled();
  });

  it("marks REAUTH_REQUIRED only for invalid_grant and otherwise leaves connection state untouched", async () => {
    const invalid = dependencies();
    vi.mocked(invalid.events.getEvent).mockRejectedValueOnce(new BookingConfirmationCredentialInvalidError());
    await expect(createBookingConfirmationService(invalid).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationReconnectRequiredError);
    expect(invalid.repository.markReauthRequired).toHaveBeenCalledWith(context.studioId, context.connection.id);
    const transient = dependencies();
    vi.mocked(transient.events.getEvent).mockRejectedValueOnce(new BookingConfirmationProviderUnavailableError());
    await expect(createBookingConfirmationService(transient).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
    expect(transient.repository.markReauthRequired).not.toHaveBeenCalled();
  });

  it("does not recreate a locally finalized event that is absent from Google", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getContext).mockResolvedValueOnce({ ...context, state: "CONFIRMED", finalized: { ...identity, confirmedAt: now } });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationMismatchError);
    expect(deps.freeBusy.queryBusy).not.toHaveBeenCalled();
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
  });
});
