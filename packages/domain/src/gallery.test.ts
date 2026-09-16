import { describe, expect, it } from "vitest";
import { InvalidGalleryInputError, normalizeGalleryDraftInput } from "./gallery.js";

describe("gallery draft input", () => {
  it("normalizes alt text and accepts gallery without artist", () => {
    expect(normalizeGalleryDraftInput({ altText: "  Tatuaje   floral\nnegro ", target: "GALLERY", artistProfileId: null })).toEqual({
      altText: "Tatuaje floral negro", target: "GALLERY", artistProfileId: null,
    });
  });

  it("requires a valid artist only for artist portfolios", () => {
    const artistProfileId = "50000000-0000-4000-8000-000000000001";
    expect(normalizeGalleryDraftInput({ altText: "Pieza geométrica", target: "ARTIST_PORTFOLIO", artistProfileId })).toEqual({ altText: "Pieza geométrica", target: "ARTIST_PORTFOLIO", artistProfileId });
    for (const input of [
      { altText: "", target: "GALLERY", artistProfileId: null },
      { altText: "x".repeat(161), target: "GALLERY", artistProfileId: null },
      { altText: "válido", target: "GALLERY", artistProfileId },
      { altText: "válido", target: "ARTIST_PORTFOLIO", artistProfileId: null },
      { altText: "válido", target: "OTHER", artistProfileId: null },
    ]) expect(() => normalizeGalleryDraftInput(input)).toThrow(InvalidGalleryInputError);
  });
});
