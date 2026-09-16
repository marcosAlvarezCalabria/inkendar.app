export type GalleryTarget = "GALLERY" | "ARTIST_PORTFOLIO";
export type GalleryDraftInput = Readonly<{ altText: string; target: GalleryTarget; artistProfileId: string | null }>;

export class InvalidGalleryInputError extends Error { readonly code = "INVALID_GALLERY_INPUT"; }

export function normalizeGalleryDraftInput(value: unknown): GalleryDraftInput {
  if (!value || typeof value !== "object") throw new InvalidGalleryInputError();
  const input = value as Record<string, unknown>;
  const altText = typeof input.altText === "string" ? input.altText.trim().replace(/\s+/gu, " ") : "";
  if (altText.length < 1 || altText.length > 160) throw new InvalidGalleryInputError();
  const target = input.target;
  if (target !== "GALLERY" && target !== "ARTIST_PORTFOLIO") throw new InvalidGalleryInputError();
  const artistProfileId = input.artistProfileId;
  if (target === "GALLERY") {
    if (artistProfileId !== null) throw new InvalidGalleryInputError();
    return { altText, target, artistProfileId: null };
  }
  if (typeof artistProfileId !== "string" || !UUID.test(artistProfileId)) throw new InvalidGalleryInputError();
  return { altText, target, artistProfileId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
