import { describe, expect, it, vi } from "vitest";

import { SupabasePublicGalleryRepository, type PublicGalleryDataGateway } from "./supabase-public-gallery.js";

const studioSlug = "a0000000-0000-4000-8000-000000000001";
const artistSlug = "b0000000-0000-4000-8000-000000000001";
const publicId = "c0000000-0000-4000-8000-000000000001";
const publishedAt = "2026-09-17T09:00:00.000Z";

function gateway(): PublicGalleryDataGateway {
  return {
    getPublicGallery: vi.fn(async () => ({
      data: {
        studio_public_slug: studioSlug,
        updated_at: "2026-09-17T10:00:00.000Z",
        gallery_images: [],
        artists: [{
          artist_public_slug: artistSlug,
          display_name: "Ana",
          portfolio_images: [{
            public_id: publicId,
            image_variants: {
              display: { path: "d0000000-0000-4000-8000-000000000001/display.webp", width: 1200, height: 800, mime_type: "image/webp", byte_size: 123, internal_id: "leak" },
              thumb: { path: "d0000000-0000-4000-8000-000000000001/thumb.webp", width: 480, height: 320, mime_type: "image/webp" },
            },
            alt_text: "Tattoo",
            position: 2,
            published_at: publishedAt,
            asset_id: "must-not-leak",
            studio_id: "must-not-leak",
          }],
          user_id: "must-not-leak",
        }],
        publication_key: "must-not-leak",
        customer: { name: "must-not-leak" },
      },
      error: null,
    })),
  };
}

describe("Supabase public gallery repository", () => {
  it("maps only the public DTO and converts public paths to versioned URLs", async () => {
    const data = gateway();
    const repository = new SupabasePublicGalleryRepository(data, "https://project.supabase.co");

    const result = await repository.getByStudioSlug(studioSlug, 100);

    expect(data.getPublicGallery).toHaveBeenCalledWith({ p_studio_slug: studioSlug, p_limit: 100 });
    expect(result).toEqual({
      studio_public_slug: studioSlug,
      updated_at: "2026-09-17T10:00:00.000Z",
      gallery_images: [],
      artists: [{
        artist_public_slug: artistSlug,
        display_name: "Ana",
        portfolio_images: [{
          public_id: publicId,
          image_variants: {
            display: { url: "https://project.supabase.co/storage/v1/object/public/gallery-public/d0000000-0000-4000-8000-000000000001/display.webp", width: 1200, height: 800, mime_type: "image/webp" },
            thumb: { url: "https://project.supabase.co/storage/v1/object/public/gallery-public/d0000000-0000-4000-8000-000000000001/thumb.webp", width: 480, height: 320, mime_type: "image/webp" },
          },
          alt_text: "Tattoo",
          position: 2,
          published_at: publishedAt,
        }],
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/asset_id|studio_id|user_id|publication_key|customer|byte_size|path|master|private/iu);
  });

  it("returns null for an unknown slug and fails closed on malformed rows or paths", async () => {
    const data = gateway();
    vi.mocked(data.getPublicGallery).mockResolvedValueOnce({ data: null, error: null });
    await expect(new SupabasePublicGalleryRepository(data, "https://project.supabase.co").getByStudioSlug(studioSlug, 100)).resolves.toBeNull();

    vi.mocked(data.getPublicGallery).mockResolvedValueOnce({ data: { studio_public_slug: studioSlug, updated_at: publishedAt, gallery_images: [{ public_id: publicId, image_variants: { display: { path: "../private/master.webp", width: 1, height: 1, mime_type: "image/webp" }, thumb: { path: "x/thumb.webp", width: 1, height: 1, mime_type: "image/webp" } }, alt_text: "x", position: 1, published_at: publishedAt }], artists: [] }, error: null });
    await expect(new SupabasePublicGalleryRepository(data, "https://project.supabase.co").getByStudioSlug(studioSlug, 100)).rejects.toThrow("Public gallery persistence failed");
  });

  it("rejects provider errors without leaking their detail", async () => {
    const data = gateway();
    vi.mocked(data.getPublicGallery).mockResolvedValueOnce({ data: null, error: { message: "secret table detail" } });
    await expect(new SupabasePublicGalleryRepository(data, "https://project.supabase.co").getByStudioSlug(studioSlug, 100)).rejects.toThrow("Public gallery persistence failed");
  });
});
