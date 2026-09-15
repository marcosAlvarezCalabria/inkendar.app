import { describe, expect, it, vi } from "vitest";
import { PublicBookingOfferSelectionRejectedError } from "@inkendar/application";

import { createPublicBookingOfferHandlers } from "./public-booking-offer.server.js";

const token = "A".repeat(43);
const selector = "a0000000-0000-4000-8000-000000000001";
const publicView = {
  state: "OPEN" as const,
  expiresAt: "2026-09-16T10:00:00.000Z",
  artistDisplayName: "Ana",
  timeZone: "Europe/Dublin",
  options: [{ selector, startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
};

describe("public booking offer handler", () => {
  it("returns only the public view with defensive headers", async () => {
    const getPublic = vi.fn(async () => publicView);
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic, selectPublic: vi.fn(), issue: vi.fn() }) });

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
    expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
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
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic, selectPublic: vi.fn(), issue: vi.fn() }) });

    const response = await handlers.loader(new Request(`https://app.inkendar.es/offers/${token}`), token);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Esta oferta no está disponible.");
    expect(response.headers.get("Location")).toBeNull();
  });
});

  it("accepts one bounded same-origin selector without redirecting or returning credentials", async () => {
    const selectPublic = vi.fn(async () => ({ state: "SELECTION_PENDING_CONFIRMATION" as const }));
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic: vi.fn(), selectPublic, issue: vi.fn() }) });
    const response = await handlers.action(new Request(`https://app.inkendar.es/offers/${token}`, {
      method: "POST",
      headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" },
      body: new URLSearchParams({ selector }),
    }), token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "SELECTION_PENDING_CONFIRMATION" });
    expect(selectPublic).toHaveBeenCalledWith(token, selector);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("rejects cross-origin selection before composing service_role", async () => {
    const createService = vi.fn();
    const handlers = createPublicBookingOfferHandlers({ createService });
    const response = await handlers.action(new Request(`https://app.inkendar.es/offers/${token}`, {
      method: "POST", headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }, body: new URLSearchParams({ selector }),
    }), token);
    expect(response.status).toBe(403);
    expect(createService).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    new URLSearchParams({ selector: "x".repeat(300) }),
    new URLSearchParams({ selector, extra: "forbidden" }),
  ])("rejects oversized or extra-field bodies before composing service_role", async (body) => {
    const createService = vi.fn();
    const handlers = createPublicBookingOfferHandlers({ createService });
    const response = await handlers.action(new Request(`https://app.inkendar.es/offers/${token}`, {
      method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body,
    }), token);
    expect(response.status).toBe(400);
    expect(createService).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(selector);
  });

  it("rejects a competing selection generically without reflecting the selector", async () => {
    const selectPublic = vi.fn(async () => { throw new PublicBookingOfferSelectionRejectedError(); });
    const handlers = createPublicBookingOfferHandlers({ createService: () => ({ getPublic: vi.fn(), selectPublic, issue: vi.fn() }) });
    const response = await handlers.action(new Request(`https://app.inkendar.es/offers/${token}`, {
      method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ selector }),
    }), token);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("No se pudo registrar la selección.");
    expect(response.headers.get("Location")).toBeNull();
  });
