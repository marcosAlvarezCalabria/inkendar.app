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
  type BookingConfirmationClaim,
  type BookingConfirmationRepositoryPort,
  type GoogleBookingEventPort,
} from "./booking-confirmation.js";
import { GOOGLE_FREE_BUSY_SCOPE, type GoogleFreeBusyPort } from "./availability.js";
import type { GoogleTokenProtectorPort } from "./google-calendar.js";

const token = "A".repeat(43), tokenHash = "ab".repeat(32);
const now = "2026-09-15T10:00:00.000Z", leaseId = "92000000-0000-4000-8000-000000000001";
const interval = { startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" };
const identity = { eventId: "inkendar0123456789abcdefghijklmnopqrstuv", correlation: "opaque-correlation" };
const connection = { id: "81000000-0000-4000-8000-000000000001", status: "ACTIVE" as const, encryptedRefreshToken: "cipher", grantedScopes: [GOOGLE_FREE_BUSY_SCOPE, GOOGLE_CALENDAR_EVENTS_SCOPE], credentialGeneration: 7 };
const context = {
  state: "PENDING" as const,
  studioId: "20000000-0000-4000-8000-000000000001",
  optionId: "91000000-0000-4000-8000-000000000001",
  ...interval,
  calendarId: "artist@example.test",
  connection,
  finalized: null,
};
const claimed: Extract<BookingConfirmationClaim, { kind: "CLAIMED" }> = {
  kind: "CLAIMED", mode: "INSERT_OR_RECONCILE", leaseId, studioId: context.studioId, optionId: context.optionId,
  ...interval, ...identity, calendarId: context.calendarId, connection, finalized: null,
};
const matchingEvent: BookingCalendarEvent = { id: identity.eventId, ...interval, status: "confirmed", summary: "Cita Inkendar", transparency: "opaque", visibility: "private", correlation: identity.correlation, attendeeCount: 0 };

function dependencies(overrides: Partial<Parameters<typeof createBookingConfirmationService>[0]> = {}) {
  const order: string[] = [];
  const repository: BookingConfirmationRepositoryPort = {
    getContext: vi.fn(async () => context),
    claim: vi.fn(async () => claimed),
    beginInsert: vi.fn(async () => { order.push("begin-insert"); return true; }),
    releaseClaim: vi.fn(async () => undefined),
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
  it("claims before Events.get and finalizes an existing exact event without FreeBusy or insert", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.getEvent).mockImplementationOnce(async () => { deps.order.push("get"); return matchingEvent; });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toEqual({ state: "CONFIRMED", confirmedAt: now });
    expect(deps.order).toEqual(["get", "finalize"]);
    expect(deps.repository.claim).toHaveBeenCalledWith({ tokenHash, ...identity, nowUtc: now });
    expect(deps.repository.finalize).toHaveBeenCalledWith({ tokenHash, leaseId, connectionId: connection.id, calendarId: context.calendarId, eventId: identity.eventId, correlation: identity.correlation, nowUtc: now });
  });

  it("revalidates exactly the selected interval then fences and inserts the minimal private opaque event", async () => {
    const deps = dependencies();
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toMatchObject({ state: "CONFIRMED" });
    expect(deps.order).toEqual(["get", "freebusy", "begin-insert", "insert", "finalize"]);
    expect(deps.freeBusy.queryBusy).toHaveBeenCalledWith("refresh", { calendarId: context.calendarId, timeMin: interval.startUtc, timeMax: interval.endUtc });
    expect(deps.repository.beginInsert).toHaveBeenCalledWith({ tokenHash, leaseId, nowUtc: now });
    expect(deps.events.insertEvent).toHaveBeenCalledWith("refresh", { calendarId: context.calendarId, eventId: identity.eventId, correlation: identity.correlation, ...interval, summary: "Cita Inkendar" });
    expect(JSON.stringify(vi.mocked(deps.events.insertEvent).mock.calls)).not.toMatch(/customer|case|attendee|description/iu);
  });

  it("does not insert or finalize when any FreeBusy interval overlaps the selection", async () => {
    const deps = dependencies();
    vi.mocked(deps.freeBusy.queryBusy).mockResolvedValueOnce([{ startUtc: interval.startUtc, endUtc: interval.endUtc }]);
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationConflictError);
    expect(deps.repository.releaseClaim).toHaveBeenCalledWith({ tokenHash, leaseId, nowUtc: now });
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
    expect(deps.repository.finalize).not.toHaveBeenCalled();
  });

  it("reconciles a matching event after an ambiguous insert response and converges without a second ID", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.insertEvent).mockImplementationOnce(async () => { deps.order.push("insert"); throw new BookingConfirmationProviderUnavailableError(); });
    vi.mocked(deps.events.getEvent).mockImplementationOnce(async () => { deps.order.push("get"); return null; })
      .mockImplementationOnce(async () => { deps.order.push("get-after-insert"); return matchingEvent; });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toMatchObject({ state: "CONFIRMED" });
    expect(deps.order).toEqual(["get", "freebusy", "begin-insert", "insert", "get-after-insert", "finalize"]);
    expect(deps.identity.create).toHaveBeenCalledTimes(1);
  });

  it("grants one concurrent request insert authority and makes the other retry then reconcile", async () => {
    const deps = dependencies();
    let leased = false;
    vi.mocked(deps.repository.claim).mockImplementation(async () => {
      if (leased) return { kind: "BUSY" };
      leased = true;
      return claimed;
    });

    const results = await Promise.allSettled([createBookingConfirmationService(deps).confirmPublic(token), createBookingConfirmationService(deps).confirmPublic(token)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" && result.reason instanceof BookingConfirmationProviderUnavailableError)).toHaveLength(1);
    expect(deps.events.insertEvent).toHaveBeenCalledOnce();
    expect(deps.events.insertEvent).toHaveBeenCalledWith("refresh", expect.objectContaining({ eventId: identity.eventId }));

    vi.mocked(deps.repository.claim).mockResolvedValueOnce({ ...claimed, mode: "RECONCILE_ONLY" });
    vi.mocked(deps.events.getEvent).mockResolvedValueOnce(matchingEvent);
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).resolves.toEqual({ state: "CONFIRMED", confirmedAt: now });
    expect(deps.events.insertEvent).toHaveBeenCalledOnce();
  });

  it("recovers an ambiguous insert only against the immutable original calendar after assignment changes", async () => {
    const deps = dependencies();
    const calendarA = "original@example.test", calendarB = "new@example.test";
    vi.mocked(deps.repository.getContext)
      .mockResolvedValueOnce({ ...context, calendarId: calendarA })
      .mockResolvedValueOnce({ ...context, calendarId: calendarB });
    vi.mocked(deps.repository.claim)
      .mockResolvedValueOnce({ ...claimed, calendarId: calendarA })
      .mockResolvedValueOnce({ ...claimed, calendarId: calendarA, mode: "RECONCILE_ONLY" });
    vi.mocked(deps.events.insertEvent).mockRejectedValueOnce(new BookingConfirmationProviderUnavailableError());
    vi.mocked(deps.events.getEvent).mockResolvedValue(null);

    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationMismatchError);

    expect(deps.events.getEvent).toHaveBeenLastCalledWith("refresh", { calendarId: calendarA, eventId: identity.eventId });
    expect(vi.mocked(deps.events.getEvent).mock.calls.some((call) => call[1].calendarId === calendarB)).toBe(false);
    expect(deps.events.insertEvent).toHaveBeenCalledOnce();
  });

  it("rejects an expired lease before insert so a stale owner cannot emit the external effect", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.beginInsert).mockResolvedValueOnce(false);
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
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
    vi.mocked(deps.repository.claim).mockResolvedValueOnce({ kind: "RECONNECT_REQUIRED" });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationReconnectRequiredError);
    expect(deps.events.getEvent).not.toHaveBeenCalled();
    expect(deps.repository.finalize).not.toHaveBeenCalled();
  });

  it("keeps INSERTING irreversible after invalid_grant and makes the retry reconciliation-only", async () => {
    const deps = dependencies();
    vi.mocked(deps.events.insertEvent).mockImplementationOnce(async () => {
      deps.order.push("insert");
      throw new BookingConfirmationCredentialInvalidError();
    });

    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationReconnectRequiredError);
    expect(deps.order).toEqual(["get", "freebusy", "begin-insert", "insert"]);
    expect(deps.repository.markReauthRequired).toHaveBeenCalledWith(context.studioId, connection.id, 7);

    vi.mocked(deps.repository.claim).mockResolvedValueOnce({ ...claimed, mode: "RECONCILE_ONLY" });
    vi.mocked(deps.events.getEvent).mockResolvedValueOnce(null);

    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationMismatchError);
    expect(deps.events.insertEvent).toHaveBeenCalledOnce();
    expect(deps.freeBusy.queryBusy).toHaveBeenCalledOnce();
  });

  it("marks only the invalid credential generation REAUTH_REQUIRED and otherwise leaves state untouched", async () => {
    const invalid = dependencies();
    vi.mocked(invalid.events.getEvent).mockRejectedValueOnce(new BookingConfirmationCredentialInvalidError());
    await expect(createBookingConfirmationService(invalid).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationReconnectRequiredError);
    expect(invalid.repository.markReauthRequired).toHaveBeenCalledWith(context.studioId, context.connection.id, 7);
    const transient = dependencies();
    vi.mocked(transient.events.getEvent).mockRejectedValueOnce(new BookingConfirmationProviderUnavailableError());
    await expect(createBookingConfirmationService(transient).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
    expect(transient.repository.markReauthRequired).not.toHaveBeenCalled();
  });

  it("does not recreate a locally finalized event that is absent from Google", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.claim).mockResolvedValueOnce({ ...claimed, mode: "RECONCILE_ONLY", finalized: { ...identity, confirmedAt: now } });
    await expect(createBookingConfirmationService(deps).confirmPublic(token)).rejects.toBeInstanceOf(BookingConfirmationMismatchError);
    expect(deps.freeBusy.queryBusy).not.toHaveBeenCalled();
    expect(deps.events.insertEvent).not.toHaveBeenCalled();
  });
});
