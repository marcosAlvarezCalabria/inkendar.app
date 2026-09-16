import { describe, expect, it, vi } from "vitest";
import { createOwnerGalleryThumbnailHandler } from "./owner-gallery-thumbnail.server.js";

describe("owner gallery thumbnail same-origin boundary", () => {
  it("rejects cross-site embedding after OWNER authorization without resolving or reading", async () => {
    const resolve = vi.fn(), read = vi.fn();
    const handler = createOwnerGalleryThumbnailHandler({
      authorize: vi.fn().mockResolvedValue({ access: { displayName: "Owner", role: "OWNER", studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" }, headers: new Headers() }),
      resolve, read,
    });
    const response = await handler(new Request("https://app.inkendar.es/app/owner/gallery/thumbnails/90000000-0000-4000-8000-000000000001", { headers: { "Sec-Fetch-Site": "cross-site" } }), "90000000-0000-4000-8000-000000000001");
    expect(response.status).toBe(404); expect(resolve).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
});
