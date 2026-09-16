import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { GalleryPublicationRepositoryPort, GalleryPublishBegin, GalleryRetireBegin } from "@inkendar/application";
import { GalleryPublicationStorage } from "./gallery-publication-storage.js";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type Result = Readonly<{ data: unknown; error: unknown }>;
export interface GalleryPublicationDataGateway {
  beginPublish(parameters: Record<string, unknown>): Promise<Result>;
  finalizePublish(parameters: Record<string, unknown>): Promise<Result>;
  beginRetire(parameters: Record<string, unknown>): Promise<Result>;
  finalizeRetire(parameters: Record<string, unknown>): Promise<Result>;
}

export class SupabaseGalleryPublicationRepository implements GalleryPublicationRepositoryPort {
  constructor(private readonly data: GalleryPublicationDataGateway) {}

  async beginPublish(handle: string): Promise<GalleryPublishBegin> {
    const { data, error } = await this.data.beginPublish({ p_handle: handle });
    if (error) failed();
    const item = singleRow(data);
    if (item.outcome === "COMPLETE") return { outcome: "COMPLETE" };
    if (item.outcome !== "WORK") failed();
    const publicationKey = uuid(item.publication_key);
    return { outcome: "WORK", publicationKey, variants: [
      publishVariant(item, "DISPLAY", publicationKey),
      publishVariant(item, "THUMB", publicationKey),
    ] };
  }

  async finalizePublish(handle: string, publicationKey: string): Promise<void> {
    const { error } = await this.data.finalizePublish({ p_handle: handle, p_publication_key: publicationKey });
    if (error) failed();
  }

  async beginRetire(handle: string): Promise<GalleryRetireBegin> {
    const { data, error } = await this.data.beginRetire({ p_handle: handle });
    if (error) failed();
    const item = singleRow(data);
    if (item.outcome === "COMPLETE") return { outcome: "COMPLETE" };
    if (item.outcome !== "WORK") failed();
    const publicationKey = uuid(item.publication_key);
    const display = string(item.public_display_path), thumb = string(item.public_thumb_path);
    if (display !== `${publicationKey}/display.webp` || thumb !== `${publicationKey}/thumb.webp`) failed();
    return { outcome: "WORK", publicationKey, publicPaths: [display, thumb] };
  }

  async finalizeRetire(handle: string, publicationKey: string): Promise<void> {
    const { error } = await this.data.finalizeRetire({ p_handle: handle, p_publication_key: publicationKey });
    if (error) failed();
  }
}

export function createSupabaseGalleryPublicationRepository(request: Request, environment: Record<string, string | undefined>): SupabaseGalleryPublicationRepository {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseGalleryPublicationRepository({
    beginPublish: async (parameters) => { const { data, error } = await client.rpc("begin_gallery_publish", parameters); return { data, error }; },
    finalizePublish: async (parameters) => { const { data, error } = await client.rpc("finalize_gallery_publish", parameters); return { data, error }; },
    beginRetire: async (parameters) => { const { data, error } = await client.rpc("begin_gallery_retire", parameters); return { data, error }; },
    finalizeRetire: async (parameters) => { const { data, error } = await client.rpc("finalize_gallery_retire", parameters); return { data, error }; },
  });
}

export function createSupabaseGalleryPublicationStorage(environment: Record<string, string | undefined>): GalleryPublicationStorage {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) failed();
  const storage = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }).storage;
  const privateBucket = storage.from("gallery-private"), publicBucket = storage.from("gallery-public");
  return new GalleryPublicationStorage(
    { sign: (path, expiresInSeconds) => privateBucket.createSignedUrl(path, expiresInSeconds) },
    { upload: (path, bytes, options) => publicBucket.upload(path, bytes, options), remove: (paths) => publicBucket.remove([...paths]) },
    url,
  );
}

function publishVariant(item: Record<string, unknown>, kind: "DISPLAY" | "THUMB", publicationKey: string) {
  const prefix = kind.toLowerCase();
  const privatePath = string(item[`private_${prefix}_path`]);
  const publicPath = string(item[`public_${prefix}_path`]);
  const mimeType = item[`private_${prefix}_mime_type`];
  const byteSize = positive(item[`private_${prefix}_byte_size`]);
  if (mimeType !== "image/webp" || !PRIVATE_PATH.test(privatePath) || !privatePath.endsWith(`/${prefix}.webp`) || publicPath !== `${publicationKey}/${prefix}.webp`) failed();
  return { kind, privatePath, publicPath, mimeType, byteSize } as const;
}
function singleRow(value: unknown): Record<string, unknown> { if (!Array.isArray(value) || value.length !== 1) failed(); return object(value[0]); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) failed(); return value; }
function uuid(value: unknown): string { const result = string(value); if (!UUID.test(result)) failed(); return result; }
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10 * 1024 * 1024) failed(); return value; }
function failed(): never { throw new Error("Gallery publication persistence failed"); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRIVATE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(display|thumb)\.webp$/iu;
