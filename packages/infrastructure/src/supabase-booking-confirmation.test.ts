import { describe, expect, it, vi } from "vitest";
import { BookingConfirmationMismatchError } from "@inkendar/application";
import { SupabaseBookingConfirmationRepository, type BookingConfirmationDataGateway } from "./supabase-booking-confirmation.js";

const tokenHash = "ab".repeat(32), now = "2026-09-15T10:00:00.000Z";
const studioId = "20000000-0000-4000-8000-000000000001", connectionId = "81000000-0000-4000-8000-000000000001";
const optionId = "91000000-0000-4000-8000-000000000001", leaseId = "92000000-0000-4000-8000-000000000001";
const eventId = "inkendar012345", correlation = "C".repeat(43);

function gateway(): BookingConfirmationDataGateway {
  return {
    getContext: vi.fn(async () => ({ data: { state: "PENDING", studio_id: studioId, option_id: optionId, start_at: "2026-09-20T09:00:00Z", end_at: "2026-09-20T10:00:00Z", calendar_id: "artist@example.test", connection: { id: connectionId, status: "ACTIVE", refresh_token_ciphertext: "cipher", granted_scopes: ["scope"], credential_generation: 7 }, finalized: null, customer: "discard", tattoo_case_id: "discard" }, error: null })),
    claim: vi.fn(async () => ({ data: { kind: "CLAIMED", mode: "INSERT_OR_RECONCILE", lease_id: leaseId, studio_id: studioId, option_id: optionId, start_at: "2026-09-20T09:00:00Z", end_at: "2026-09-20T10:00:00Z", calendar_id: "artist@example.test", event_id: eventId, correlation, connection: { id: connectionId, status: "ACTIVE", refresh_token_ciphertext: "cipher", granted_scopes: ["scope"], credential_generation: 7 }, finalized: null }, error: null })),
    beginInsert: vi.fn(async () => ({ data: true, error: null })),
    releaseClaim: vi.fn(async () => ({ data: null, error: null })),
    resetInsert: vi.fn(async () => ({ data: null, error: null })),
    finalize: vi.fn(async () => ({ data: { confirmed_at: now, appointment_id: "discard" }, error: null })),
    markReauthRequired: vi.fn(async () => ({ data: false, error: null })),
  };
}

describe("Supabase booking confirmation repository", () => {
  it("loads strict internal preparation context without unrelated domain data", async () => {
    const data = gateway();
    const result = await new SupabaseBookingConfirmationRepository(data).getContext({ tokenHash, nowUtc: now });
    expect(data.getContext).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_now: now });
    expect(result).toEqual({ state: "PENDING", studioId, optionId, startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z", calendarId: "artist@example.test", connection: { id: connectionId, status: "ACTIVE", encryptedRefreshToken: "cipher", grantedScopes: ["scope"], credentialGeneration: 7 }, finalized: null });
    expect(JSON.stringify(result)).not.toMatch(/customer|tattoo|case/iu);
  });

  it("maps the durable claim and every fencing/CAS RPC parameter", async () => {
    const data = gateway(), repository = new SupabaseBookingConfirmationRepository(data);
    await expect(repository.claim({ tokenHash, eventId, correlation, nowUtc: now })).resolves.toMatchObject({ kind: "CLAIMED", mode: "INSERT_OR_RECONCILE", leaseId, calendarId: "artist@example.test", connection: { credentialGeneration: 7 } });
    expect(data.claim).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_event_id: eventId, p_correlation: correlation, p_now: now });
    await expect(repository.beginInsert({ tokenHash, leaseId, nowUtc: now })).resolves.toBe(true);
    expect(data.beginInsert).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_lease_id: leaseId, p_now: now });
    await repository.releaseClaim({ tokenHash, leaseId, nowUtc: now });
    expect(data.releaseClaim).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_lease_id: leaseId, p_now: now });
    await repository.resetInsert({ tokenHash, leaseId, nowUtc: now });
    expect(data.resetInsert).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_lease_id: leaseId, p_now: now });
    await expect(repository.finalize({ tokenHash, leaseId, connectionId, calendarId: "artist@example.test", eventId, correlation, nowUtc: now })).resolves.toEqual({ confirmedAt: now });
    expect(data.finalize).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_lease_id: leaseId, p_connection_id: connectionId, p_calendar_id: "artist@example.test", p_event_id: eventId, p_correlation: correlation, p_now: now });
    await repository.markReauthRequired(studioId, connectionId, 7);
    expect(data.markReauthRequired).toHaveBeenCalledWith({ p_studio_id: studioId, p_connection_id: connectionId, p_credential_generation: 7 });
  });

  it.each(["BUSY", "RECONNECT_REQUIRED"] as const)("maps the %s claim without leaking bound details", async (kind) => {
    const data = gateway();
    vi.mocked(data.claim).mockResolvedValueOnce({ data: { kind, ignored: "secret" }, error: null });
    await expect(new SupabaseBookingConfirmationRepository(data).claim({ tokenHash, eventId, correlation, nowUtc: now })).resolves.toEqual({ kind });
  });

  it("maps a binding or provider-identity mismatch to the closed review state", async () => {
    const data = gateway();
    vi.mocked(data.finalize).mockResolvedValueOnce({ data: null, error: { code: "P0003" } });
    await expect(new SupabaseBookingConfirmationRepository(data).finalize({ tokenHash, leaseId, connectionId, calendarId: "artist@example.test", eventId, correlation, nowUtc: now }))
      .rejects.toBeInstanceOf(BookingConfirmationMismatchError);
  });

  it("fails closed on malformed or ambiguous RPC payloads", async () => {
    const data = gateway();
    vi.mocked(data.getContext).mockResolvedValueOnce({ data: { state: "PENDING" }, error: null });
    await expect(new SupabaseBookingConfirmationRepository(data).getContext({ tokenHash, nowUtc: now })).rejects.toThrow("Booking confirmation persistence failed");
    vi.mocked(data.claim).mockResolvedValueOnce({ data: { kind: "CLAIMED" }, error: null });
    await expect(new SupabaseBookingConfirmationRepository(data).claim({ tokenHash, eventId, correlation, nowUtc: now })).rejects.toThrow("Booking confirmation persistence failed");
  });
});
