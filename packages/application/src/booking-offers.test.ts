import { describe, expect, it, vi } from "vitest";

import { createBookingOfferService, type BookingOfferRepositoryPort } from "./booking-offers.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const caseId = "70000000-0000-4000-8000-000000000001";
const artistId = "50000000-0000-4000-8000-000000000001";
const now = "2026-09-15T10:00:00.000Z";
const option = { startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T10:00:00.000Z" };

function repository(): BookingOfferRepositoryPort {
  return {
    getManagement: vi.fn(async () => ({ expiryHours: 24, cases: [], artists: [], offers: [] })),
    saveExpiryHours: vi.fn(async () => undefined),
    createOffer: vi.fn(async (input) => ({ id: "90000000-0000-4000-8000-000000000001", status: "OPEN" as const, expiresAt: "2026-09-16T10:00:00.000Z", createdAt: now, ...input })),
    expireDue: vi.fn(async () => 0),
  };
}

describe("booking offer service", () => {
  it("validates and creates against the authorized studio using the server clock", async () => {
    const repo = repository();
    await createBookingOfferService({ repository: repo, clock: () => new Date(now) }).create(studioId, caseId, artistId, [option]);
    expect(repo.createOffer).toHaveBeenCalledWith({ studioId, tattooCaseId: caseId, artistProfileId: artistId, options: [option], nowUtc: now });
  });

  it("uses the same server clock for idempotent due-expiry and validates settings", async () => {
    const repo = repository();
    const service = createBookingOfferService({ repository: repo, clock: () => new Date(now) });
    await service.expireDue(studioId);
    expect(repo.expireDue).toHaveBeenCalledWith(studioId, now);
    await expect(service.configureExpiry(studioId, 0)).rejects.toThrow("Booking offer input is invalid");
    expect(repo.saveExpiryHours).not.toHaveBeenCalled();
  });
});
