import { describe, expect, it, vi } from "vitest";

import { createOwnerBookingOfferHandlers } from "./owner-booking-offers.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };
const offerId = "90000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);

describe("owner public booking offer access", () => {
  it("returns a newly issued path URL only in the same-origin POST response without redirecting", async () => {
    const issue = vi.fn(async () => ({ token, expiresAt: "2026-09-16T10:00:00.000Z" }));
    const createAccessService = vi.fn(() => ({ issue, getPublic: vi.fn() }));
    const createService = vi.fn();
    const handlers = createOwnerBookingOfferHandlers({ authorize: async () => ({ access, headers: new Headers() }), createService, createAccessService });
    const form = new FormData();
    form.set("intent", "rotate-access");
    form.set("offerId", offerId);

    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/offers", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessUrl: `https://app.inkendar.es/offers/${token}`, expiresAt: "2026-09-16T10:00:00.000Z" });
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(createAccessService).toHaveBeenCalledWith(access);
    expect(issue).toHaveBeenCalledWith(access.studioId, offerId);
    expect(createService).not.toHaveBeenCalled();
  });

  it("does not compose privileged access before owner authorization", async () => {
    const createAccessService = vi.fn();
    const handlers = createOwnerBookingOfferHandlers({ authorize: async () => new Response("Denied", { status: 403 }), createService: vi.fn(), createAccessService });
    const form = new FormData();
    form.set("intent", "rotate-access");
    form.set("offerId", offerId);

    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/offers", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form }));

    expect(response.status).toBe(403);
    expect(createAccessService).not.toHaveBeenCalled();
  });
});
