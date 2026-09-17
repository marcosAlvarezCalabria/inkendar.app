export type PublicGalleryImageVariant = Readonly<{
  url: string;
  width: number;
  height: number;
  mime_type: "image/webp";
}>;

export type PublicGalleryImage = Readonly<{
  public_id: string;
  image_variants: Readonly<{
    display: PublicGalleryImageVariant;
    thumb: PublicGalleryImageVariant;
  }>;
  alt_text: string;
  position: number;
  published_at: string;
}>;

export type StudioGallery = Readonly<{
  studio_public_slug: string;
  updated_at: string;
  gallery_images: readonly PublicGalleryImage[];
  artists: readonly Readonly<{
    artist_public_slug: string;
    display_name: string;
    portfolio_images: readonly PublicGalleryImage[];
  }>[];
}>;

export interface PublicGalleryRepositoryPort {
  getByStudioSlug(studioSlug: string, limit: number): Promise<StudioGallery | null>;
}

export class PublicGalleryUnavailableError extends Error {
  readonly code = "PUBLIC_GALLERY_UNAVAILABLE";
  constructor() { super("Public gallery unavailable"); }
}

export class PublicGalleryFailedError extends Error {
  readonly code = "PUBLIC_GALLERY_FAILED";
  constructor() { super("Public gallery failed"); }
}

const PUBLIC_GALLERY_LIMIT = 100;
const PUBLIC_SLUG = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function createPublicGalleryService(repository: PublicGalleryRepositoryPort) {
  return {
    async get(studioSlugInput: string): Promise<StudioGallery> {
      if (!PUBLIC_SLUG.test(studioSlugInput)) throw new PublicGalleryUnavailableError();
      try {
        const gallery = await repository.getByStudioSlug(studioSlugInput, PUBLIC_GALLERY_LIMIT);
        if (gallery === null) throw new PublicGalleryUnavailableError();
        return gallery;
      } catch (error) {
        if (error instanceof PublicGalleryUnavailableError) throw error;
        throw new PublicGalleryFailedError();
      }
    },
  };
}
