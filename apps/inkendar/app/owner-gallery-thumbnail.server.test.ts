import { describe, expect, it, vi } from "vitest";
import { createOwnerGalleryThumbnailHandler } from "./owner-gallery-thumbnail.server.js";

const access = { displayName: "Owner", role: "OWNER" as const, studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };
const handle = "90000000-0000-4000-8000-000000000001";

describe("owner gallery thumbnail proxy", () => {
  it("authorizes before resolving metadata or reading storage", async () => {
    const resolve = vi.fn(), read = vi.fn();
    const handler = createOwnerGalleryThumbnailHandler({ authorize: vi.fn().mockResolvedValue(new Response(null, { status: 302 })), resolve, read });
    expect((await handler(new Request(`https://app.inkendar.es/app/owner/gallery/thumbnails/${handle}`), handle)).status).toBe(302);
    expect(resolve).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  it("proxies bounded WebP bytes with conservative headers", async () => {
    const resolve = vi.fn().mockResolvedValue({ path: "private/internal/thumb.webp", byteSize: 3 });
    const read = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
    const handler = createOwnerGalleryThumbnailHandler({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), resolve, read });
    const response = await handler(new Request(`https://app.inkendar.es/app/owner/gallery/thumbnails/${handle}`), handle);
    expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("image/webp"); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff"); expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(resolve).toHaveBeenCalledWith(expect.any(Request), handle); expect(read).toHaveBeenCalledWith("private/internal/thumb.webp", 3);
  });

  it.each(["invalid", "90000000-0000-4000-8000-000000000099"])("returns a generic 404 for invalid or inaccessible handle %s", async (candidate) => {
    const handler = createOwnerGalleryThumbnailHandler({ authorize: vi.fn().mockResolvedValue({ access, headers: new Headers() }), resolve: vi.fn().mockRejectedValue(new Error("bucket/private/path")), read: vi.fn() });
    const response = await handler(new Request(`https://app.inkendar.es/app/owner/gallery/thumbnails/${candidate}`), candidate);
    expect(response.status).toBe(404); expect(await response.text()).toBe("Miniatura no disponible"); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
