import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { GalleryDraftRecord, GalleryDraftRow, GalleryMoveDirection, GalleryRepositoryPort, PrivateGalleryStoragePort } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";
import { GalleryThumbnailReader } from "./gallery-thumbnail-reader.js";

const BUCKET = "gallery-private";
type Result = Readonly<{ data: unknown; error: unknown }>;
export interface GalleryDataGateway {
  createDraft(parameters: Record<string, unknown>): Promise<Result>;
  listDrafts(parameters: Record<string, unknown>): Promise<Result>;
  resolveThumbnail(parameters: Record<string, unknown>): Promise<Result>;
  updateDraft(parameters: Record<string, unknown>): Promise<Result>;
  moveDraft(parameters: Record<string, unknown>): Promise<Result>;
  discardDraft(parameters: Record<string, unknown>): Promise<Result>;
}
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
    return (data as unknown[]).map(row);
  }
  async resolveThumbnail(handle: string): Promise<{ path: string; byteSize: number }> {
    const { data, error } = await this.data.resolveThumbnail({ p_handle: handle });
    if (error || !Array.isArray(data) || data.length !== 1) failed();
    const item = object(data[0]); return { path: string(item.object_path), byteSize: positive(item.byte_size) };
  }
  async updateDraft(handle: string, input: Readonly<{ altText: string; target: "GALLERY" | "ARTIST_PORTFOLIO"; artistProfileId: string | null }>): Promise<void> {
    const { error } = await this.data.updateDraft({ p_handle: handle, p_alt_text: input.altText, p_target: input.target, p_artist_profile_id: input.artistProfileId });
    if (error) failed();
  }
  async moveDraft(handle: string, direction: GalleryMoveDirection): Promise<void> {
    const { error } = await this.data.moveDraft({ p_handle: handle, p_direction: direction });
    if (error) failed();
  }
  async discardDraft(handle: string): Promise<void> {
    const { error } = await this.data.discardDraft({ p_handle: handle });
    if (error) failed();
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
  return new SupabaseGalleryRepository({
    createDraft: async (parameters) => { const { data, error } = await client.rpc("create_gallery_draft", parameters); return { data, error }; },
    listDrafts: async (parameters) => { const { data, error } = await client.rpc("list_gallery_assets_v3", parameters); return { data, error }; },
    resolveThumbnail: async (parameters) => { const { data, error } = await client.rpc("resolve_gallery_thumbnail", parameters); return { data, error }; },
    updateDraft: async (parameters) => { const { data, error } = await client.rpc("update_gallery_draft", parameters); return { data, error }; },
    moveDraft: async (parameters) => { const { data, error } = await client.rpc("move_gallery_draft", parameters); return { data, error }; },
    discardDraft: async (parameters) => { const { data, error } = await client.rpc("discard_gallery_draft", parameters); return { data, error }; },
  });
}

export function createSupabasePrivateGalleryStorage(environment: Record<string, string | undefined>): SupabasePrivateGalleryStorage {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) storageFailed();
  const bucket = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }).storage.from(BUCKET);
  return new SupabasePrivateGalleryStorage({ upload: (path, bytes, options) => bucket.upload(path, bytes, options), remove: (paths) => bucket.remove([...paths]), sign: (path, expiresIn) => bucket.createSignedUrl(path, expiresIn) });
}

export function createSupabaseGalleryThumbnailReader(environment: Record<string, string | undefined>): GalleryThumbnailReader {
  const url = environment.SUPABASE_URL?.trim(); if (!url) storageFailed();
  return new GalleryThumbnailReader(createSupabasePrivateGalleryStorage(environment), url);
}

export async function listSupabaseGalleryArtists(request: Request, environment: Record<string, string | undefined>): Promise<readonly { id: string; displayName: string }[]> {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  const { data, error } = await client.from("artist_profile").select("id,display_name").order("display_name").limit(100);
  if (error || !Array.isArray(data)) failed();
  return data.map((value) => { const item = object(value); return { id: string(item.id), displayName: string(item.display_name) }; });
}

function row(value: unknown): GalleryDraftRow {
  const item = object(value), target = item.target, status = item.status;
  if (target !== "GALLERY" && target !== "ARTIST_PORTFOLIO") failed();
  if (status !== "DRAFT" && status !== "PUBLISHING" && status !== "PUBLISHED" && status !== "RETIRING") failed();
  const result: GalleryDraftRow & Readonly<{ status: typeof status }> = { thumbnailHandle: string(item.thumbnail_handle), status, target, artistProfileId: nullableString(item.artist_profile_id), artistDisplayName: nullableString(item.artist_display_name), altText: string(item.alt_text), position: positive(item.position), width: positive(item.width), height: positive(item.height) };
  return result;
}
function safePath(path: string): void { if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(master|display|thumb)\.webp$/iu.test(path) || path.includes("..")) storageFailed(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) failed(); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1) failed(); return value; }
function failed(): never { throw new Error("Gallery persistence failed"); }
function storageFailed(): never { throw new Error("Gallery storage failed"); }
