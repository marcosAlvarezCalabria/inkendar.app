import { createClient } from "@supabase/supabase-js";
import type { PublicGalleryImage, PublicGalleryImageVariant, PublicGalleryRepositoryPort, StudioGallery } from "@inkendar/application";

type Result = Readonly<{ data: unknown; error: unknown }>;

export interface PublicGalleryDataGateway {
  getPublicGallery(parameters: Record<string, unknown>): Promise<Result>;
}

export class SupabasePublicGalleryRepository implements PublicGalleryRepositoryPort {
  private readonly storageOrigin: string;

  constructor(private readonly data: PublicGalleryDataGateway, supabaseUrl: string) {
    this.storageOrigin = safeOrigin(supabaseUrl);
  }

  async getByStudioSlug(studioSlug: string, limit: number): Promise<StudioGallery | null> {
    const { data, error } = await this.data.getPublicGallery({ p_studio_slug: studioSlug, p_limit: limit });
    if (error) failed();
    if (data === null) return null;
    const result = object(data);
    const returnedSlug = uuid(result.studio_public_slug);
    if (returnedSlug !== studioSlug || !Number.isInteger(limit) || limit < 1 || limit > 100) failed();
    const galleryImages = array(result.gallery_images).map((value) => image(value, this.storageOrigin));
    const artists = array(result.artists).map((value) => artist(value, this.storageOrigin));
    const allImages = [...galleryImages, ...artists.flatMap((value) => value.portfolio_images)];
    if (allImages.length > limit || new Set(allImages.map((value) => value.public_id)).size !== allImages.length) failed();
    if (new Set(artists.map((value) => value.artist_public_slug)).size !== artists.length) failed();
    return {
      studio_public_slug: returnedSlug,
      updated_at: timestamp(result.updated_at),
      gallery_images: galleryImages,
      artists,
    };
  }
}

export function createSupabasePublicGalleryRepository(environment: Record<string, string | undefined>): SupabasePublicGalleryRepository {
  const url = environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) failed();
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabasePublicGalleryRepository({
    getPublicGallery: async (parameters) => {
      const { data, error } = await client.rpc("get_public_studio_gallery", parameters);
      return { data, error };
    },
  }, url);
}

function artist(value: unknown, origin: string): StudioGallery["artists"][number] {
  const item = object(value);
  return {
    artist_public_slug: uuid(item.artist_public_slug),
    display_name: boundedString(item.display_name, 120),
    portfolio_images: array(item.portfolio_images).map((entry) => image(entry, origin)),
  };
}

function image(value: unknown, origin: string): PublicGalleryImage {
  const item = object(value);
  const variants = object(item.image_variants);
  return {
    public_id: uuid(item.public_id),
    image_variants: {
      display: variant(variants.display, origin, "display"),
      thumb: variant(variants.thumb, origin, "thumb"),
    },
    alt_text: boundedString(item.alt_text, 160),
    position: positiveInteger(item.position),
    published_at: timestamp(item.published_at),
  };
}

function variant(value: unknown, origin: string, kind: "display" | "thumb"): PublicGalleryImageVariant {
  const item = object(value);
  if (item.mime_type !== "image/webp") failed();
  const path = publicPath(item.path, kind);
  return {
    url: `${origin}/storage/v1/object/public/gallery-public/${path}`,
    width: positiveInteger(item.width),
    height: positiveInteger(item.height),
    mime_type: "image/webp",
  };
}

function safeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) failed();
    return url.origin;
  } catch { failed(); }
}

function publicPath(value: unknown, kind: "display" | "thumb"): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/${kind}\\.webp$`, "u").test(value) || value.includes("..")) failed();
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failed();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) failed(); return value; }
function boundedString(value: unknown, max: number): string { if (typeof value !== "string" || value.length < 1 || value.length > max) failed(); return value; }
function positiveInteger(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1) failed(); return value; }
function uuid(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) failed(); return value; }
function timestamp(value: unknown): string {
  if (typeof value !== "string") failed();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) failed();
  return date.toISOString();
}
function failed(): never { throw new Error("Public gallery persistence failed"); }
