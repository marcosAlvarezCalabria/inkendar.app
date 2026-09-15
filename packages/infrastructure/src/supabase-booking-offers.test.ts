import { describe, expect, it, vi } from "vitest";

import { BookingHoldConflictError } from "@inkendar/application";
import { SupabaseBookingOfferRepository, type BookingOfferDataGateway } from "./supabase-booking-offers.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const studioId = "20000000-0000-4000-8000-000000000001";

function gateway(): BookingOfferDataGateway {
  return {
    getManagement: vi.fn(async () => ({ data: { expiry_hours: 24, cases: [], artists: [], offers: [] }, error: null })),
    saveExpiryHours: vi.fn(async () => ({ data: null, error: null })),
    createOffer: vi.fn(async () => ({ data: { id: "90000000-0000-4000-8000-000000000001", tattoo_case_id: "70000000-0000-4000-8000-000000000001", artist_profile_id: "50000000-0000-4000-8000-000000000001", status: "OPEN", expires_at: "2026-09-16T10:00:00.000Z", created_at: "2026-09-15T10:00:00.000Z", options: [] }, error: null })),
    expireDue: vi.fn(async () => ({ data: 1, error: null })),
  };
}

describe("Supabase booking offer repository", () => {
  it("binds reads and writes to owner plus studio and maps results strictly", async () => {
    const data = gateway();
    const repository = new SupabaseBookingOfferRepository(data, ownerId);
    expect(await repository.getManagement(studioId)).toEqual({ expiryHours: 24, cases: [], artists: [], offers: [] });
    expect(data.getManagement).toHaveBeenCalledWith({ p_studio_id: studioId, p_owner_user_id: ownerId });
    expect(await repository.expireDue(studioId, "2026-09-17T00:00:00.000Z")).toBe(1);
    expect(data.expireDue).toHaveBeenCalledWith({ p_studio_id: studioId, p_owner_user_id: ownerId, p_now: "2026-09-17T00:00:00.000Z" });
  });

  it("maps an overlapping active hold to a stable application error", async () => {
    const data = gateway();
    vi.mocked(data.createOffer).mockResolvedValueOnce({ data: null, error: { code: "23P01" } });
    await expect(new SupabaseBookingOfferRepository(data, ownerId).createOffer({ studioId, tattooCaseId: "70000000-0000-4000-8000-000000000001", artistProfileId: "50000000-0000-4000-8000-000000000001", options: [{ startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T10:00:00.000Z" }], nowUtc: "2026-09-15T10:00:00.000Z" })).rejects.toBeInstanceOf(BookingHoldConflictError);
  });
});
