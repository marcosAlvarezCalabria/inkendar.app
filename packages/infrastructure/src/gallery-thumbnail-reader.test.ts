import { describe, expect, it, vi } from "vitest";
import { GalleryThumbnailReader, GalleryThumbnailUnavailableError } from "./gallery-thumbnail-reader.js";

const path = "20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000001/thumb.webp";
const signed = `http://127.0.0.1:54321/storage/v1/object/sign/gallery-private/${path}?token=server-secret`;
const gateway = { sign: vi.fn().mockResolvedValue(signed) };

describe("GalleryThumbnailReader", () => {
  it("signs and fetches server-side without returning the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type": "image/webp", "Content-Length": "3" } }));
    const reader = new GalleryThumbnailReader(gateway, "http://127.0.0.1:54321", fetcher, 100);
    await expect(reader.read(path, 3)).resolves.toEqual({ bytes: new Uint8Array([1,2,3]), contentType: "image/webp" });
    expect(fetcher).toHaveBeenCalledWith(signed, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it.each([
    ["foreign origin", "https://evil.test/object", new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/webp" } })],
    ["wrong content type", signed, new Response(new Uint8Array([1]), { headers: { "Content-Type": "text/html" } })],
    ["oversized declared body", signed, new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/webp", "Content-Length": "11" } })],
  ])("rejects %s", async (_name, url, response) => {
    const reader = new GalleryThumbnailReader({ sign: vi.fn().mockResolvedValue(url) }, "http://127.0.0.1:54321", vi.fn().mockResolvedValue(response), 100);
    await expect(reader.read(path, 10)).rejects.toBeInstanceOf(GalleryThumbnailUnavailableError);
  });

  it("rejects a streamed body that exceeds the persisted bound", async () => {
    const response = new Response(new Uint8Array([1,2,3,4]), { headers: { "Content-Type": "image/webp" } });
    const reader = new GalleryThumbnailReader(gateway, "http://127.0.0.1:54321", vi.fn().mockResolvedValue(response), 100);
    await expect(reader.read(path, 3)).rejects.toBeInstanceOf(GalleryThumbnailUnavailableError);
  });

  it("aborts and fails generically on timeout", async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const reader = new GalleryThumbnailReader(gateway, "http://127.0.0.1:54321", fetcher, 5);
    await expect(reader.read(path, 3)).rejects.toBeInstanceOf(GalleryThumbnailUnavailableError);
  });
});
