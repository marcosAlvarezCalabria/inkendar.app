import { describe, expect, it, vi } from "vitest";

import { PublicGalleryUnavailableError, createPublicGalleryService, type PublicGalleryRepositoryPort, type StudioGallery } from "./public-gallery.js";

const studioSlug = "a0000000-0000-4000-8000-000000000001";

const gallery: StudioGallery = {
  studio_public_slug: studioSlug,
  updated_at: "2026-09-17T10:00:00.000Z",
  gallery_images: [],
  artists: [],
};

describe("public gallery service", () => {
  it("resolves a canonical public studio slug with the fixed feed limit", async () => {
    const repository: PublicGalleryRepositoryPort = { getByStudioSlug: vi.fn(async () => gallery) };
    await expect(createPublicGalleryService(repository).get(studioSlug)).resolves.toEqual(gallery);
    expect(repository.getByStudioSlug).toHaveBeenCalledWith(studioSlug, 100);
  });

  it.each(["", "Studio Name", studioSlug.toUpperCase(), "a0000000-0000-0000-0000-000000000001"])("rejects a non-canonical or non-v4 slug uniformly", async (slug) => {
    const repository: PublicGalleryRepositoryPort = { getByStudioSlug: vi.fn() };
    await expect(createPublicGalleryService(repository).get(slug)).rejects.toBeInstanceOf(PublicGalleryUnavailableError);
    expect(repository.getByStudioSlug).not.toHaveBeenCalled();
  });

  it("maps an unknown studio or persistence failure to generic errors", async () => {
    const missing: PublicGalleryRepositoryPort = { getByStudioSlug: vi.fn(async () => null) };
    await expect(createPublicGalleryService(missing).get(studioSlug)).rejects.toMatchObject({ code: "PUBLIC_GALLERY_UNAVAILABLE" });

    const failed: PublicGalleryRepositoryPort = { getByStudioSlug: vi.fn(async () => { throw new Error("provider detail"); }) };
    await expect(createPublicGalleryService(failed).get(studioSlug)).rejects.toMatchObject({ code: "PUBLIC_GALLERY_FAILED", message: "Public gallery failed" });
  });
});
