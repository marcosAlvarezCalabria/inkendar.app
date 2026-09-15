import { describe, expect, it, vi } from "vitest";

import { createOwnerBookingOfferHandlers } from "./owner-booking-offers.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };

function service() {
  return { list: vi.fn(async () => ({ expiryHours: 24, cases: [], artists: [], offers: [] })), configureExpiry: vi.fn(async () => undefined), create: vi.fn(async (studioId: string, tattooCaseId: string, artistProfileId: string, options: readonly { startUtc: string; endUtc: string }[]) => ({ id: "90000000-0000-4000-8000-000000000001", studioId, tattooCaseId, artistProfileId, options: options.map((option, index) => ({ id: `90000000-0000-4000-8000-00000000000${index + 2}`, status: "HELD" as const, ...option })), status: "OPEN" as const, expiresAt: "2026-09-16T10:00:00.000Z", createdAt: "2026-09-15T10:00:00.000Z" })), expireDue: vi.fn(async () => 1) };
}

describe("owner booking offer handlers", () => {
  it("fails closed before composing the service for ARTIST or anonymous", async () => {
    const createService = vi.fn();
    const handlers = createOwnerBookingOfferHandlers({ authorize: async () => new Response("Denied", { status: 403 }), createService });
    expect((await handlers.loader(new Request("https://app.inkendar.es/app/owner/offers"))).status).toBe(403);
    expect(createService).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutations before authorization", async () => {
    const authorize = vi.fn();
    const handlers = createOwnerBookingOfferHandlers({ authorize, createService: vi.fn() });
    expect((await handlers.action(new Request("https://app.inkendar.es/app/owner/offers", { method: "POST", headers: { Origin: "https://evil.test" }, body: new FormData() }))).status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("parses one to three option lines and uses only server-authorized tenant context", async () => {
    const subject = service();
    const handlers = createOwnerBookingOfferHandlers({ authorize: async () => ({ access, headers: new Headers() }), createService: () => subject });
    const form = new FormData();
    form.set("intent", "create"); form.set("tattooCaseId", "70000000-0000-4000-8000-000000000001"); form.set("artistProfileId", "50000000-0000-4000-8000-000000000001");
    form.set("options", "2026-09-16T09:00,2026-09-16T10:00\n2026-09-17T09:00,2026-09-17T10:00");
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/offers", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form }));
    expect(response.status).toBe(303);
    expect(subject.create).toHaveBeenCalledWith(access.studioId, "70000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000001", [
      { startUtc: "2026-09-16T09:00:00.000Z", endUtc: "2026-09-16T10:00:00.000Z" },
      { startUtc: "2026-09-17T09:00:00.000Z", endUtc: "2026-09-17T10:00:00.000Z" },
    ]);
  });
});
