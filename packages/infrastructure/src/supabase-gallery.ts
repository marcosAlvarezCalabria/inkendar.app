import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { GalleryDraftRecord, GalleryDraftRow, GalleryRepositoryPort, PrivateGalleryStoragePort } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

const BUCKET = "gallery-private";
type Result = Readonly<{ data: unknown; error: unknown }>;
export interface GalleryDataGateway { createDraft(parameters: Record<string, unknown>): Promise<Result>; listDrafts(parameters: Record<string, unknown>): Promise<Result>; }
export interface GalleryStorageGateway { upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }): Promise<{ error: unknown }>; remove(paths: readonly string[]): Promise<{ error: unknown }>; sign(path: string, expiresIn: number): Promise<{ data: unknown; error: unknown }>; }

export class SupabaseGalleryRepository implements GalleryRepositoryPort {
  constructor(private readonly data: GalleryDataGateway) {}
  async createDraft(record: GalleryDraftRecord): Promise<{ id: string }> {
    const { data, error } = await this.data.createDraft({ p_studio_id: record.studioId, p_asset_id: record.id, p_target: record.target, p_artist_profile_id: record.artistProfileId, p_alt_text: record.altText, p_variants: record.variants.map((variant) => ({ kind: variant.kind, path: variant.path, width: variant.width, height: variant.height, mime_type: variant.mimeType, byte_size: variant.byteSize })) });
    if (error || data !== record.id) failed();
    return { id: record.id };
  }
  async listDrafts(studioId: string, limit: number): Promise<readonly GalleryDraftRow[]> {
    const { data, error } = await this.data.listDrafts({ p_studio_id: studioId, p_limit: limit });
    if (error || !Array.isArray(data)) failed();
    return (data as unknown[]).map((value) => row(value, studioId));
  }
}

export class SupabasePrivateGalleryStorage implements PrivateGalleryStoragePort {
  constructor(private readonly storage: GalleryStorageGateway) {}
  async upload(path: string, object: Readonly<{ bytes: Uint8Array; contentType: "image/webp" }>): Promise<void> { safePath(path); const { error } = await this.storage.upload(path, object.bytes, { contentType: object.contentType, upsert: false }); if (error) storageFailed(); }
  async remove(paths: readonly string[]): Promise<void> { if (!paths.length) return; paths.forEach(safePath); const { error } = await this.storage.remove(paths); if (error) storageFailed(); }
  async sign(path: string, expiresInSeconds: number): Promise<string> { safePath(path); if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) storageFailed(); const { data, error } = await this.storage.sign(path, expiresInSeconds); const value = object(data).signedUrl; if (error || typeof value !== "string" || !value.startsWith("http")) storageFailed(); return value as string; }
}

export function createSupabaseGalleryRepository(request: Request, environment: Record<string, string | undefined>): SupabaseGalleryRepository {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseGalleryRepository({ createDraft: async (parameters) => { const { data, error } = await client.rpc("create_gallery_draft", parameters); return { data, error }; }, listDrafts: async (parameters) => { const { data, error } = await client.rpc("list_gallery_drafts", parameters); return { data, error }; } });
}

export function createSupabasePrivateGalleryStorage(environment: Record<string, string | undefined>): SupabasePrivateGalleryStorage {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) storageFailed();
  const bucket = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }).storage.from(BUCKET);
  return new SupabasePrivateGalleryStorage({ upload: (path, bytes, options) => bucket.upload(path, bytes, options), remove: (paths) => bucket.remove([...paths]), sign: (path, expiresIn) => bucket.createSignedUrl(path, expiresIn) });
}

export async function listSupabaseGalleryArtists(request: Request, environment: Record<string, string | undefined>): Promise<readonly { id: string; displayName: string }[]> {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  const { data, error } = await client.from("artist_profile").select("id,display_name").order("display_name").limit(100);
  if (error || !Array.isArray(data)) failed();
  return data.map((value) => { const item = object(value); return { id: string(item.id), displayName: string(item.display_name) }; });
}

function row(value: unknown, studioId: string): GalleryDraftRow {
  const item = object(value), target = item.target;
  if (target !== "GALLERY" && target !== "ARTIST_PORTFOLIO") failed();
  const thumbPath = string(item.thumb_path); if (!thumbPath.startsWith(`${studioId}/`)) failed();
  return { publicId: string(item.public_id), target, artistDisplayName: nullableString(item.artist_display_name), altText: string(item.alt_text), position: positive(item.position), width: positive(item.width), height: positive(item.height), thumbPath };
}
function safePath(path: string): void { if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(master|display|thumb)\.webp$/iu.test(path) || path.includes("..")) storageFailed(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) failed(); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1) failed(); return value; }
function failed(): never { throw new Error("Gallery persistence failed"); }
function storageFailed(): never { throw new Error("Gallery storage failed"); }
