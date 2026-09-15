import { describe, expect, it, vi } from "vitest";

import {
  PublicBookingOfferUnavailableError,
  createBookingOfferAccessService,
  type BookingOfferAccessRepositoryPort,
  type PublicBookingOfferRepositoryPort,
} from "./booking-offer-access.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const offerId = "90000000-0000-4000-8000-000000000001";
const now = "2026-09-15T10:00:00.000Z";
const expiresAt = "2026-09-16T10:00:00.000Z";
const tokenHash = "ab".repeat(32);
const selector = "a0000000-0000-4000-8000-000000000001";

function ownerRepository(): BookingOfferAccessRepositoryPort {
  return { rotateAccess: vi.fn(async () => ({ expiresAt })) };
}

function publicRepository(): PublicBookingOfferRepositoryPort {
  return {
    selectByTokenHash: vi.fn(async () => undefined),
    getByTokenHash: vi.fn(async () => ({
      state: "OPEN" as const,
      expiresAt,
      artistDisplayName: "Ana",
      timeZone: "Europe/Dublin",
      options: [{ selector, startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
    })),
  };
}

describe("booking offer public access service", () => {
  it("issues a 256-bit token but sends only its SHA-256 hash to persistence", async () => {
    const owner = ownerRepository();
    const randomBytes = vi.fn(() => Uint8Array.from({ length: 32 }, (_, index) => index));
    const hashToken = vi.fn(() => tokenHash);
    const service = createBookingOfferAccessService({ ownerRepository: owner, publicRepository: publicRepository(), randomBytes, hashToken, clock: () => new Date(now) });

    const result = await service.issue(studioId, offerId);

    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(result).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), expiresAt });
    expect(hashToken).toHaveBeenCalledWith(result.token);
    expect(owner.rotateAccess).toHaveBeenCalledWith({ studioId, offerId, tokenHash, nowUtc: now });
    expect(JSON.stringify(vi.mocked(owner.rotateAccess).mock.calls)).not.toContain(result.token);
  });

  it("resolves a canonical token to the strict public view using the server clock", async () => {
    const publicOffers = publicRepository();
    const service = createBookingOfferAccessService({ ownerRepository: ownerRepository(), publicRepository: publicOffers, randomBytes: vi.fn(), hashToken: () => tokenHash, clock: () => new Date(now) });
    const token = "A".repeat(43);

    await expect(service.getPublic(token)).resolves.toEqual({
      state: "OPEN",
      expiresAt,
      artistDisplayName: "Ana",
      timeZone: "Europe/Dublin",
      options: [{ selector, startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
    });
    expect(publicOffers.getByTokenHash).toHaveBeenCalledWith({ tokenHash, nowUtc: now });
  });

  it("submits only the token hash and canonical opaque selector and returns one pending state for first and repeated selection", async () => {
    const publicOffers = publicRepository();
    const hashToken = vi.fn(() => tokenHash);
    const service = createBookingOfferAccessService({ ownerRepository: ownerRepository(), publicRepository: publicOffers, randomBytes: vi.fn(), hashToken, clock: () => new Date(now) });

    await expect(service.selectPublic("A".repeat(43), selector)).resolves.toEqual({ state: "SELECTION_PENDING_CONFIRMATION" });
    expect(publicOffers.selectByTokenHash).toHaveBeenCalledWith({ tokenHash, selector, nowUtc: now });
    expect(JSON.stringify(vi.mocked(publicOffers.selectByTokenHash).mock.calls)).not.toContain("A".repeat(43));
  });

  it.each(["90000000-0000-0000-0000-000000000001", selector.toUpperCase(), "invalid"])("rejects malformed selectors before hashing or persistence", async (rawSelector) => {
    const publicOffers = publicRepository();
    const hashToken = vi.fn(() => tokenHash);
    const service = createBookingOfferAccessService({ ownerRepository: ownerRepository(), publicRepository: publicOffers, randomBytes: vi.fn(), hashToken, clock: () => new Date(now) });

    await expect(service.selectPublic("A".repeat(43), rawSelector)).rejects.toMatchObject({ code: "PUBLIC_BOOKING_OFFER_SELECTION_REJECTED" });
    expect(hashToken).not.toHaveBeenCalled();
    expect(publicOffers.selectByTokenHash).not.toHaveBeenCalled();
  });

  it.each(["invalid", `${"A".repeat(42)}=`, ` ${"A".repeat(43)}`])("fails uniformly before hashing malformed tokens", async (token) => {
    const publicOffers = publicRepository();
    const hashToken = vi.fn(() => tokenHash);
    const service = createBookingOfferAccessService({ ownerRepository: ownerRepository(), publicRepository: publicOffers, randomBytes: vi.fn(), hashToken, clock: () => new Date(now) });

    await expect(service.getPublic(token)).rejects.toBeInstanceOf(PublicBookingOfferUnavailableError);
    expect(hashToken).not.toHaveBeenCalled();
    expect(publicOffers.getByTokenHash).not.toHaveBeenCalled();
  });

  it("maps an unknown, rotated, expired or released access to one unavailable error", async () => {
    const publicOffers = publicRepository();
    vi.mocked(publicOffers.getByTokenHash).mockResolvedValueOnce(null);
    const service = createBookingOfferAccessService({ ownerRepository: ownerRepository(), publicRepository: publicOffers, randomBytes: vi.fn(), hashToken: () => tokenHash, clock: () => new Date(now) });

    await expect(service.getPublic("A".repeat(43))).rejects.toBeInstanceOf(PublicBookingOfferUnavailableError);
  });
});
