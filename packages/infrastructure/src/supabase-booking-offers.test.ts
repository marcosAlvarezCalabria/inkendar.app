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

  it("maps the selected-pending-confirmation offer and chosen option without calling it confirmed", async () => {
    const data = gateway();
    vi.mocked(data.getManagement).mockResolvedValueOnce({ data: { expiry_hours: 24, cases: [], artists: [], offers: [{ id: "90000000-0000-4000-8000-000000000001", tattoo_case_id: "70000000-0000-4000-8000-000000000001", artist_profile_id: "50000000-0000-4000-8000-000000000001", status: "SELECTED_PENDING_CONFIRMATION", expires_at: "2026-09-16T10:00:00.000Z", created_at: "2026-09-15T10:00:00.000Z", options: [{ id: "91000000-0000-4000-8000-000000000001", start_at: "2026-09-20T09:00:00.000Z", end_at: "2026-09-20T10:00:00.000Z", status: "SELECTED" }] }] }, error: null });

    const result = await new SupabaseBookingOfferRepository(data, ownerId).getManagement(studioId);

    expect(result.offers[0]?.status).toBe("SELECTED_PENDING_CONFIRMATION");
    expect(result.offers[0]?.options[0]?.status).toBe("SELECTED");
    expect(JSON.stringify(result)).not.toContain("CONFIRMED");
  });
