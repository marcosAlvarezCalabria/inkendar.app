import { describe, expect, it, vi } from "vitest";

import { createPublicBookingOfferHandlers } from "./public-booking-offer.server.js";

const token = "A".repeat(43);
const publicView = {
  expiresAt: "2026-09-16T10:00:00.000Z",
  artistDisplayName: "Ana",
  timeZone: "Europe/Dublin",
  options: [{ startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
};

describe("public booking offer handler", () => {
  it("returns only the public view with defensive headers", async () => {
    const getPublic = vi.fn(async () => publicView);
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic, issue: vi.fn() }) });

    const response = await handlers.loader(new Request(`https://app.inkendar.es/offers/${token}`), token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(publicView);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(getPublic).toHaveBeenCalledWith(token);
  });

  it.each(["invalid", `${"A".repeat(42)}=`, undefined])("fails malformed access uniformly before composing service_role", async (rawToken) => {
    const createService = vi.fn();
    const handlers = createPublicBookingOfferHandlers({ createService });
    const response = await handlers.loader(new Request("https://app.inkendar.es/offers/redacted"), rawToken);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Esta oferta no está disponible.");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(createService).not.toHaveBeenCalled();
  });

  it("uses the same generic 404 for unknown, rotated, expired, released and infrastructure failures", async () => {
    const getPublic = vi.fn(async () => { throw new Error("provider detail"); });
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic, issue: vi.fn() }) });

    const response = await handlers.loader(new Request(`https://app.inkendar.es/offers/${token}`), token);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Esta oferta no está disponible.");
    expect(response.headers.get("Location")).toBeNull();
  });
});
