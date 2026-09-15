import { describe, expect, it, vi } from "vitest";
import { BookingConfirmationMismatchError } from "@inkendar/application";
import { SupabaseBookingConfirmationRepository, type BookingConfirmationDataGateway } from "./supabase-booking-confirmation.js";

const tokenHash = "ab".repeat(32), now = "2026-09-15T10:00:00.000Z";
const studioId = "20000000-0000-4000-8000-000000000001", connectionId = "81000000-0000-4000-8000-000000000001";
function gateway(): BookingConfirmationDataGateway {
  return {
    getContext: vi.fn(async () => ({ data: { state: "PENDING", studio_id: studioId, option_id: "91000000-0000-4000-8000-000000000001", start_at: "2026-09-20T09:00:00Z", end_at: "2026-09-20T10:00:00Z", calendar_id: "artist@example.test", connection: { id: connectionId, status: "ACTIVE", refresh_token_ciphertext: "cipher", granted_scopes: ["scope"] }, finalized: null, customer: "discard", tattoo_case_id: "discard" }, error: null })),
    finalize: vi.fn(async () => ({ data: { confirmed_at: now, appointment_id: "discard" }, error: null })),
    markReauthRequired: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase booking confirmation repository", () => {
  it("loads strict internal coordination context by hash without returning unrelated domain data", async () => {
    const data = gateway();
    const result = await new SupabaseBookingConfirmationRepository(data).getContext({ tokenHash, nowUtc: now });
    expect(data.getContext).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_now: now });
    expect(result).toEqual({ state: "PENDING", studioId, optionId: "91000000-0000-4000-8000-000000000001", startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z", calendarId: "artist@example.test", connection: { id: connectionId, status: "ACTIVE", encryptedRefreshToken: "cipher", grantedScopes: ["scope"] }, finalized: null });
    expect(JSON.stringify(result)).not.toMatch(/customer|tattoo|case/iu);
  });

  it("finalizes and marks reauth through dedicated service-role RPC parameters", async () => {
    const data = gateway(), repository = new SupabaseBookingConfirmationRepository(data);
    await expect(repository.finalize({ tokenHash, connectionId, calendarId: "artist@example.test", eventId: "inkendar012345", correlation: "C".repeat(43), nowUtc: now })).resolves.toEqual({ confirmedAt: now });
    expect(data.finalize).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_connection_id: connectionId, p_calendar_id: "artist@example.test", p_event_id: "inkendar012345", p_correlation: "C".repeat(43), p_now: now });
    await repository.markReauthRequired(studioId, connectionId);
    expect(data.markReauthRequired).toHaveBeenCalledWith({ p_studio_id: studioId, p_connection_id: connectionId });
  });

  it("maps a concurrent assignment or provider-identity mismatch to the closed review state", async () => {
    const data = gateway();
    vi.mocked(data.finalize).mockResolvedValueOnce({ data: null, error: { code: "P0003" } });

    await expect(new SupabaseBookingConfirmationRepository(data).finalize({ tokenHash, connectionId, calendarId: "artist@example.test", eventId: "inkendar012345", correlation: "C".repeat(43), nowUtc: now }))
      .rejects.toBeInstanceOf(BookingConfirmationMismatchError);
  });

  it("fails closed on malformed or ambiguous RPC payloads", async () => {
    const data = gateway();
    vi.mocked(data.getContext).mockResolvedValueOnce({ data: { state: "PENDING" }, error: null });
    await expect(new SupabaseBookingConfirmationRepository(data).getContext({ tokenHash, nowUtc: now })).rejects.toThrow("Booking confirmation persistence failed");
    vi.mocked(data.getContext).mockResolvedValueOnce({ data: null, error: null });
    await expect(new SupabaseBookingConfirmationRepository(data).getContext({ tokenHash, nowUtc: now })).resolves.toBeNull();
  });
});
