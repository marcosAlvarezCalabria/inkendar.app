import { describe, expect, it, vi } from "vitest";
import { GalleryMutationFailedError } from "@inkendar/application";
import { createOwnerGalleryHandlers } from "./owner-gallery.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };

describe("owner gallery handlers", () => {
  it("authorizes before composing private gallery dependencies", async () => {
    const createService = vi.fn();
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue(new Response(null, { status: 302 })), createService });
    expect((await handlers.loader(new Request("https://app.inkendar.es/app/owner/gallery"))).status).toBe(302);
    expect(createService).not.toHaveBeenCalled();
  });
  it("returns bounded discarded metadata separately without thumbnail URLs or internal identifiers", async () => {
    const handle = "90000000-0000-4000-8000-000000000099";
    const curation = { list: vi.fn().mockResolvedValue([]), listDiscarded: vi.fn().mockResolvedValue([{ handle, target: "GALLERY", artistDisplayName: null, altText: "Recuperable", discardedAt: "2026-09-17T10:00:00.000Z" }]) };
    const handlers = createOwnerGalleryHandlers({
      authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }),
      createService: vi.fn(),
      createCurationService: vi.fn().mockReturnValue(curation),
      listArtists: vi.fn().mockResolvedValue([]),
    });
    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/gallery"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ drafts: [], discarded: [{ handle, target: "GALLERY", artistDisplayName: null, altText: "Recuperable", discardedAt: "2026-09-17T10:00:00.000Z" }], artists: [] });
    expect(JSON.stringify(await curation.listDiscarded.mock.results[0]!.value)).not.toMatch(/thumbnail|path|bucket|binding|assetId|studioId|userId/i);
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
    const form = new FormData(); form.set("intent", "CREATE_DRAFT"); form.set("altText", "  Pieza floral "); form.set("target", "GALLERY"); form.set("image", new File([new Uint8Array([255, 216, 255])], "private-name.jpg", { type: "text/plain" }));
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form }));
    expect(response.status).toBe(303);
    expect(service.ingest).toHaveBeenCalledWith({ studioId: access.studioId, bytes: new Uint8Array([255, 216, 255]), altText: "  Pieza floral ", target: "GALLERY", artistProfileId: null });
    expect(JSON.stringify(service.ingest.mock.calls)).not.toContain("private-name.jpg");
  });

  it("returns bounded generic errors without filenames or paths", async () => {
    const service = { ingest: vi.fn().mockRejectedValue(new Error("private-name.jpg bucket/path")), list: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new FormData(); form.set("intent", "CREATE_DRAFT"); form.set("altText", "Pieza"); form.set("target", "GALLERY"); form.set("image", new File([new Uint8Array([1])], "private-name.jpg"));
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body: form }));
    expect(response.status).toBe(500); expect(await response.text()).toBe('{"error":"No se pudo guardar la imagen."}');
  });

  it.each([
    ["UPDATE", { altText: "  Nuevo   alt ", target: "GALLERY", artistProfileId: "" }, "update"],
    ["MOVE_UP", {}, "move"],
    ["MOVE_DOWN", {}, "move"],
    ["DISCARD", {}, "discard"],
    ["RESTORE", {}, "restore"],
  ] as const)("handles %s through one exact intent and redirects with PRG", async (intent, fields, expectedMethod) => {
    const service = { ingest: vi.fn(), list: vi.fn(), update: vi.fn(), move: vi.fn(), discard: vi.fn(), restore: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new URLSearchParams({ intent, handle: "90000000-0000-4000-8000-000000000001", ...fields });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
    expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe("/app/owner/gallery");
    expect(service[expectedMethod]).toHaveBeenCalledOnce();
    expect(JSON.stringify(service[expectedMethod].mock.calls)).not.toMatch(/studioId|userId|assetId|path|status/);
  });

  it("rejects duplicate intent and unexpected internal fields without invoking a mutation", async () => {
    const service = { ingest: vi.fn(), list: vi.fn(), update: vi.fn(), move: vi.fn(), discard: vi.fn(), restore: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const duplicate = new URLSearchParams([["intent", "RESTORE"], ["intent", "RESTORE"], ["handle", "90000000-0000-4000-8000-000000000001"]]);
    const unexpected = new URLSearchParams({ intent: "RESTORE", handle: "90000000-0000-4000-8000-000000000001", studioId: access.studioId });
    for (const body of [duplicate, unexpected]) {
      const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body }));
      expect(response.status).toBe(400);
    }
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("rejects browser tenant identity on create before composing a service", async () => {
    const createService = vi.fn();
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService });
    const form = new FormData(); form.set("intent", "CREATE_DRAFT"); form.set("altText", "Pieza"); form.set("target", "GALLERY"); form.set("artistProfileId", ""); form.set("image", new File([new Uint8Array([1])], "private.jpg")); form.set("studioId", access.studioId);
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body: form }));
    expect(response.status).toBe(400); expect(createService).not.toHaveBeenCalled();
  });

  it("returns a generic private error for an inaccessible mutation", async () => {
    const service = { ingest: vi.fn(), list: vi.fn(), update: vi.fn().mockRejectedValue(new GalleryMutationFailedError()), move: vi.fn(), discard: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new URLSearchParams({ intent: "UPDATE", handle: "90000000-0000-4000-8000-000000000099", altText: "Pieza", target: "GALLERY", artistProfileId: "" });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
    expect(response.status).toBe(500); expect(await response.text()).toBe('{"error":"No se pudo actualizar el borrador."}');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("composes curation without the ingestion or service-role Storage service", async () => {
    const createService = vi.fn(), curation = { list: vi.fn(), update: vi.fn(), move: vi.fn().mockResolvedValue(undefined), discard: vi.fn() };
    const createCurationService = vi.fn().mockReturnValue(curation);
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService, createCurationService });
    const form = new URLSearchParams({ intent: "MOVE_UP", handle: "90000000-0000-4000-8000-000000000001" });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
    expect(response.status).toBe(303); expect(createCurationService).toHaveBeenCalledOnce(); expect(createService).not.toHaveBeenCalled();
  });

  it.each(["UPDATE_DRAFT", "DISCARD_DRAFT"])("rejects the obsolete %s alias", async (intent) => {
    const service = { ingest: vi.fn(), list: vi.fn(), update: vi.fn(), move: vi.fn(), discard: vi.fn() };
    const handlers = createOwnerGalleryHandlers({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), createService: vi.fn().mockReturnValue(service) });
    const form = new URLSearchParams({ intent, handle: "90000000-0000-4000-8000-000000000001", altText: "Pieza", target: "GALLERY", artistProfileId: "" });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/gallery", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
    expect(response.status).toBe(400); expect(service.update).not.toHaveBeenCalled(); expect(service.discard).not.toHaveBeenCalled();
  });
});
