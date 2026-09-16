import { describe, expect, it, vi } from "vitest";
import { createOwnerGalleryHandlers } from "./owner-gallery.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };

describe("owner gallery handlers", () => {
  it("authorizes before composing private gallery dependencies", async () => {
    const createService = vi.fn();
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue(new Response(null, { status: 302 })), createService });
    expect((await handlers.loader(new Request("https://app.inkendar.es/app/owner/gallery"))).status).toBe(302);
    expect(createService).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and non-multipart writes without composing", async () => {
    const createService = vi.fn(); const authorize = vi.fn();
    const handlers = createOwnerGalleryHandlers({ authorize, createService });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://evil.test" }, body: "x" }));
    expect(response.status).toBe(403); expect(authorize).not.toHaveBeenCalled(); expect(createService).not.toHaveBeenCalled();
  });

  it("accepts one image without trusting filename or MIME and never passes browser tenant IDs", async () => {
    const service = { ingest: vi.fn().mockResolvedValue(undefined), list: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new FormData(); form.set("altText", "  Pieza floral "); form.set("target", "GALLERY"); form.set("image", new File([new Uint8Array([255, 216, 255])], "private-name.jpg", { type: "text/plain" })); form.set("studioId", "attacker");
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form }));
    expect(response.status).toBe(303);
    expect(service.ingest).toHaveBeenCalledWith({ studioId: access.studioId, bytes: new Uint8Array([255, 216, 255]), altText: "  Pieza floral ", target: "GALLERY", artistProfileId: null });
    expect(JSON.stringify(service.ingest.mock.calls)).not.toContain("private-name.jpg");
  });

  it("returns bounded generic errors without filenames or paths", async () => {
    const service = { ingest: vi.fn().mockRejectedValue(new Error("private-name.jpg bucket/path")), list: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new FormData(); form.set("altText", "Pieza"); form.set("target", "GALLERY"); form.set("image", new File([new Uint8Array([1])], "private-name.jpg"));
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body: form }));
    expect(response.status).toBe(500); expect(await response.text()).toBe('{"error":"No se pudo guardar la imagen."}');
  });
});
