import { describe, expect, it, vi } from "vitest";
import { GalleryPublicationFailedError } from "@inkendar/application";
import { createOwnerGalleryHandlers } from "./owner-gallery.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };

describe("owner gallery publication handler", () => {
  it.each(["PUBLISH", "RETIRE"] as const)("handles %s with only an opaque handle and PRG", async (intent) => {
    const publication = { publish: vi.fn().mockResolvedValue(undefined), retire: vi.fn().mockResolvedValue(undefined) };
    const createPublicationService = vi.fn().mockReturnValue(publication);
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn(), createPublicationService });
    const body = new URLSearchParams({ intent, handle: "90000000-0000-4000-8000-000000000001" });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" }, body }));
    expect(response.status).toBe(303);
    expect(publication[intent === "PUBLISH" ? "publish" : "retire"]).toHaveBeenCalledWith("90000000-0000-4000-8000-000000000001");
    expect(body.toString()).not.toMatch(/studio|user|asset|path|key|status/i);
  });

  it("authorizes and validates the exact form before composing publication dependencies", async () => {
    const createPublicationService = vi.fn();
    const unauthorized = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue(new Response(null, { status: 403 })), createService: vi.fn(), createPublicationService });
    const request = () => new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ intent: "PUBLISH", handle: "90000000-0000-4000-8000-000000000001" }) });
    expect((await unauthorized.action(request())).status).toBe(403);
    expect(createPublicationService).not.toHaveBeenCalled();

    const authorized = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn(), createPublicationService });
    const invalid = new URLSearchParams({ intent: "PUBLISH", handle: "90000000-0000-4000-8000-000000000001", publicationKey: "70000000-0000-4000-8000-000000000001" });
    expect((await authorized.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: invalid }))).status).toBe(400);
    expect(createPublicationService).not.toHaveBeenCalled();
  });

  it("maps failures to a generic private error without provider or binding detail", async () => {
    const publication = { publish: vi.fn().mockRejectedValue(new GalleryPublicationFailedError()), retire: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn(), createPublicationService: vi.fn().mockReturnValue(publication) });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ intent: "PUBLISH", handle: "90000000-0000-4000-8000-000000000001" }) }));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"No se pudo cambiar la publicación."}');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
