import { describe, expect, it, vi } from "vitest";
import { GalleryPublicationStorage, GalleryPublicationStorageError } from "./gallery-publication-storage.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const assetId = "60000000-0000-4000-8000-000000000001";
const publicationKey = "70000000-0000-4000-8000-000000000001";
const source = { kind: "DISPLAY" as const, privatePath: `${studioId}/${assetId}/display.webp`, publicPath: `${publicationKey}/display.webp`, mimeType: "image/webp" as const, byteSize: 3 };
const signed = `http://127.0.0.1:54321/storage/v1/object/sign/gallery-private/${source.privatePath}?token=server-secret`;

describe("GalleryPublicationStorage", () => {
  it("downloads a bounded private WebP without redirects and uploads with conservative cache/upsert", async () => {
    const privateGateway = { sign: vi.fn().mockResolvedValue({ data: { signedUrl: signed }, error: null }) };
    const publicGateway = { upload: vi.fn().mockResolvedValue({ data: { path: source.publicPath }, error: null }), remove: vi.fn() };
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp", "Content-Length": "3" } }));
    const storage = new GalleryPublicationStorage(privateGateway, publicGateway, "http://127.0.0.1:54321", fetcher, 100);
    const bytes = await storage.readPrivate(source);
    await storage.uploadPublic(source.publicPath, bytes);
    expect(fetcher).toHaveBeenCalledWith(signed, expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal), headers: { Accept: "image/webp" } }));
    expect(publicGateway.upload).toHaveBeenCalledWith(source.publicPath, bytes, { contentType: "image/webp", cacheControl: "300", upsert: true });
  });

  it.each([
    ["MASTER", { ...source, kind: "MASTER", privatePath: `${studioId}/${assetId}/master.webp`, publicPath: `${publicationKey}/master.webp` }],
    ["wrong MIME", { ...source, mimeType: "image/jpeg" }],
    ["oversize", { ...source, byteSize: 10 * 1024 * 1024 + 1 }],
    ["mismatched kind path", { ...source, privatePath: `${studioId}/${assetId}/thumb.webp` }],
  ])("rejects %s before signing", async (_label, invalid) => {
    const privateGateway = { sign: vi.fn() };
    const storage = new GalleryPublicationStorage(privateGateway, { upload: vi.fn(), remove: vi.fn() }, "http://127.0.0.1:54321", vi.fn(), 100);
    await expect(storage.readPrivate(invalid as never)).rejects.toBeInstanceOf(GalleryPublicationStorageError);
    expect(privateGateway.sign).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign origin", "https://evil.test/object", new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } })],
    ["wrong response MIME", signed, new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "text/html", "Content-Length": "3" } })],
    ["wrong response size", signed, new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/webp", "Content-Length": "2" } })],
  ])("rejects %s", async (_label, signedUrl, response) => {
    const storage = new GalleryPublicationStorage({ sign: vi.fn().mockResolvedValue({ data: { signedUrl }, error: null }) }, { upload: vi.fn(), remove: vi.fn() }, "http://127.0.0.1:54321", vi.fn().mockResolvedValue(response), 100);
    await expect(storage.readPrivate(source)).rejects.toBeInstanceOf(GalleryPublicationStorageError);
  });

  it("aborts a private download on timeout", async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const storage = new GalleryPublicationStorage({ sign: vi.fn().mockResolvedValue({ data: { signedUrl: signed }, error: null }) }, { upload: vi.fn(), remove: vi.fn() }, "http://127.0.0.1:54321", fetcher, 5);
    await expect(storage.readPrivate(source)).rejects.toBeInstanceOf(GalleryPublicationStorageError);
  });

  it("verifies upload/remove responses and only accepts opaque public paths", async () => {
    const publicGateway = { upload: vi.fn().mockResolvedValue({ data: null, error: new Error("failed") }), remove: vi.fn().mockResolvedValue({ data: null, error: new Error("failed") }) };
    const storage = new GalleryPublicationStorage({ sign: vi.fn() }, publicGateway, "http://127.0.0.1:54321");
    await expect(storage.uploadPublic(`${studioId}/${assetId}/display.webp`, new Uint8Array([1]))).rejects.toBeInstanceOf(GalleryPublicationStorageError);
    await expect(storage.uploadPublic(`${publicationKey}/display.webp`, new Uint8Array([1]))).rejects.toBeInstanceOf(GalleryPublicationStorageError);
    await expect(storage.removePublic([`${publicationKey}/display.webp`, `${publicationKey}/thumb.webp`])).rejects.toBeInstanceOf(GalleryPublicationStorageError);
  });
});
