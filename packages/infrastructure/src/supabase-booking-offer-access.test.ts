import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  SupabaseBookingOfferAccessRepository,
  SupabasePublicBookingOfferRepository,
  secureBookingOfferTokenBytes,
  sha256BookingOfferToken,
  type BookingOfferAccessDataGateway,
} from "./supabase-booking-offer-access.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const studioId = "20000000-0000-4000-8000-000000000001";
const offerId = "90000000-0000-4000-8000-000000000001";
const now = "2026-09-15T10:00:00.000Z";
const expiresAt = "2026-09-16T10:00:00.000Z";
const tokenHash = "ab".repeat(32);
const selector = "a0000000-0000-4000-8000-000000000001";

function gateway(): BookingOfferAccessDataGateway {
  return {
    rotateAccess: vi.fn(async () => ({ data: { expires_at: expiresAt }, error: null })),
    getPublic: vi.fn(async () => ({
      data: {
        state: "OPEN",
        expires_at: expiresAt,
        artist_display_name: "Ana",
        time_zone: "Europe/Dublin",
        options: [{ selector, start_at: "2026-09-20T09:00:00.000Z", end_at: "2026-09-20T10:00:00.000Z", internal_id: offerId }],
        tattoo_case_id: "70000000-0000-4000-8000-000000000001",
        customer: { name: "Must not leak" },
        token_hash: tokenHash,
      },
      error: null,
    })),
    selectPublic: vi.fn(async () => ({ data: { state: "SELECTION_PENDING_CONFIRMATION" }, error: null })),
  };
}

describe("Supabase public booking offer access", () => {
  it("binds OWNER rotation to authorized user and tenant using only the token hash", async () => {
    const data = gateway();
    const repository = new SupabaseBookingOfferAccessRepository(data, ownerId);

    await expect(repository.rotateAccess({ studioId, offerId, tokenHash, nowUtc: now })).resolves.toEqual({ expiresAt });
    expect(data.rotateAccess).toHaveBeenCalledWith({ p_studio_id: studioId, p_owner_user_id: ownerId, p_offer_id: offerId, p_token_hash: tokenHash, p_now: now });
    expect(JSON.stringify(vi.mocked(data.rotateAccess).mock.calls)).not.toContain("public-token");
  });

  it("maps only approved public fields and discards every internal or customer field", async () => {
    const data = gateway();
    const repository = new SupabasePublicBookingOfferRepository(data);

    const result = await repository.getByTokenHash({ tokenHash, nowUtc: now });

    expect(data.getPublic).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_now: now });
    expect(result).toEqual({
      state: "OPEN",
      expiresAt,
      artistDisplayName: "Ana",
      timeZone: "Europe/Dublin",
      options: [{ selector, startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/customer|tattoo|internal|token|hash|provider|conversation|contact|title|event/iu);
  });


  it("binds selection to token hash, selector and server time without returning either credential", async () => {
    const data = gateway();
    const repository = new SupabasePublicBookingOfferRepository(data);

    await expect(repository.selectByTokenHash({ tokenHash, selector, nowUtc: now })).resolves.toBeUndefined();
    expect(data.selectPublic).toHaveBeenCalledWith({ p_token_hash: tokenHash, p_option_selector: selector, p_now: now });
  });

  it.each([
    [{ code: "P0002" }, "PUBLIC_BOOKING_OFFER_UNAVAILABLE"],
    [{ code: "P0003" }, "PUBLIC_BOOKING_OFFER_SELECTION_REJECTED"],
  ] as const)("maps selection failures to stable generic application errors", async (error, code) => {
    const data = gateway();
    vi.mocked(data.selectPublic).mockResolvedValueOnce({ data: null, error });
    await expect(new SupabasePublicBookingOfferRepository(data).selectByTokenHash({ tokenHash, selector, nowUtc: now })).rejects.toMatchObject({ code });
  });

  it("maps a selected pending view to only the chosen interval and never accepts a selector in that state", async () => {
    const data = gateway();
    vi.mocked(data.getPublic).mockResolvedValueOnce({ data: { state: "SELECTION_PENDING_CONFIRMATION", expires_at: expiresAt, artist_display_name: "Ana", time_zone: null, options: [{ start_at: "2026-09-20T09:00:00.000Z", end_at: "2026-09-20T10:00:00.000Z" }] }, error: null });
    await expect(new SupabasePublicBookingOfferRepository(data).getByTokenHash({ tokenHash, nowUtc: now })).resolves.toEqual({ state: "SELECTION_PENDING_CONFIRMATION", expiresAt, artistDisplayName: "Ana", timeZone: null, options: [{ startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }] });
  });
  it("returns null uniformly for unknown, rotated, expired or released access", async () => {
    const data = gateway();
    vi.mocked(data.getPublic).mockResolvedValueOnce({ data: null, error: null });
    await expect(new SupabasePublicBookingOfferRepository(data).getByTokenHash({ tokenHash, nowUtc: now })).resolves.toBeNull();
  });

  it("provides audited Node crypto primitives for 256-bit generation and SHA-256", () => {
    const bytes = secureBookingOfferTokenBytes(32);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(32);
    expect(sha256BookingOfferToken("A".repeat(43))).toBe(createHash("sha256").update("A".repeat(43), "utf8").digest("hex"));
  });
});
