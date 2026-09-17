import { describe, expect, it, vi } from "vitest";
import type { StudioGallery } from "@inkendar/application";
import type { PublicGalleryRateLimiter } from "@inkendar/public-content";

import { createPublicGalleryHandlers } from "./public-gallery.server.js";

const slug = "a0000000-0000-4000-8000-000000000001";
const feed: StudioGallery = { studio_public_slug: slug, updated_at: "2026-09-17T10:00:00.000Z", gallery_images: [], artists: [] };
const limiter: PublicGalleryRateLimiter = { consume: () => ({ allowed: true, limit: 120, remaining: 119, resetSeconds: 60 }) };

describe("public gallery server composition", () => {
  it("loads the public feed through a lazily composed server-only service", async () => {
    const get = vi.fn(async () => feed);
    const createService = vi.fn(() => ({ get }));
    const response = await createPublicGalleryHandlers({ createService }, limiter).loader(new Request("https://app.test/feed"), slug);

    expect(response.status).toBe(200);
    expect(createService).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(slug);
  });

  it("rejects a write method before composing Supabase or any privileged client", async () => {
    const createService = vi.fn();
    const response = await createPublicGalleryHandlers({ createService }, limiter).loader(new Request("https://app.test/feed", { method: "POST" }), slug);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(createService).not.toHaveBeenCalled();
  });
});
