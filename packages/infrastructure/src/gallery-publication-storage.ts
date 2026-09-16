import type { GalleryPublicationStoragePort, GalleryPublishVariant } from "@inkendar/application";

const MAX_BYTES = 10 * 1024 * 1024;
const PRIVATE_PREFIX = "/storage/v1/object/sign/gallery-private/";
const PRIVATE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(display|thumb)\.webp$/iu;
const PUBLIC_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(display|thumb)\.webp$/iu;

export class GalleryPublicationStorageError extends Error {
  readonly code = "GALLERY_PUBLICATION_STORAGE_FAILED";
  constructor() { super("Gallery publication storage failed"); }
}

export interface GalleryPublicationPrivateGateway {
  sign(path: string, expiresInSeconds: number): Promise<{ data: unknown; error: unknown }>;
}

export interface GalleryPublicationPublicGateway {
  upload(path: string, bytes: Uint8Array, options: { contentType: "image/webp"; cacheControl: "300"; upsert: true }): Promise<{ data: unknown; error: unknown }>;
  remove(paths: readonly string[]): Promise<{ data: unknown; error: unknown }>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class GalleryPublicationStorage implements GalleryPublicationStoragePort {
  private readonly allowedOrigin: string;

  constructor(
    private readonly privateGateway: GalleryPublicationPrivateGateway,
    private readonly publicGateway: GalleryPublicationPublicGateway,
    allowedStorageUrl: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 3_000,
  ) {
    try { this.allowedOrigin = new URL(allowedStorageUrl).origin; }
    catch { throw new GalleryPublicationStorageError(); }
  }

  async readPrivate(variant: GalleryPublishVariant): Promise<Uint8Array> {
    validateVariant(variant);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const signedResult = await this.privateGateway.sign(variant.privatePath, 30);
      const signedValue = object(signedResult.data).signedUrl;
      if (signedResult.error || typeof signedValue !== "string") failed();
      const signed = new URL(signedValue);
      if (signed.origin !== this.allowedOrigin || !signed.pathname.startsWith(PRIVATE_PREFIX)) failed();
      const response = await this.fetcher(signed.toString(), { method: "GET", redirect: "error", signal: controller.signal, headers: { Accept: "image/webp" } });
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      const declared = response.headers.get("Content-Length");
      if (!response.ok || contentType !== "image/webp" || (declared !== null && Number(declared) !== variant.byteSize) || !response.body) failed();
      const bytes = await readExact(response.body, variant.byteSize);
      return bytes;
    } catch (error) {
      if (error instanceof GalleryPublicationStorageError) throw error;
      throw new GalleryPublicationStorageError();
    } finally { clearTimeout(timer); }
  }

  async uploadPublic(path: string, bytes: Uint8Array): Promise<void> {
    validPublicPath(path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) failed();
    const { data, error } = await this.publicGateway.upload(path, bytes, { contentType: "image/webp", cacheControl: "300", upsert: true });
    const storedPath = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).path : undefined;
    if (error || storedPath !== path) failed();
  }

  async removePublic(paths: readonly string[]): Promise<void> {
    if (paths.length !== 2 || new Set(paths).size !== 2) failed();
    paths.forEach(validPublicPath);
    const { data, error } = await this.publicGateway.remove(paths);
    if (error || !Array.isArray(data)) failed();
  }
}

async function readExact(body: ReadableStream<Uint8Array>, expected: number): Promise<Uint8Array> {
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > expected) { await reader.cancel(); failed(); }
    chunks.push(chunk.value);
  }
  if (total !== expected) failed();
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function validateVariant(variant: GalleryPublishVariant): void {
  const kind = variant.kind;
  if ((kind !== "DISPLAY" && kind !== "THUMB") || variant.mimeType !== "image/webp" || !Number.isInteger(variant.byteSize) || variant.byteSize < 1 || variant.byteSize > MAX_BYTES) failed();
  if (!PRIVATE_PATH.test(variant.privatePath) || !variant.privatePath.endsWith(`/${kind.toLowerCase()}.webp`)) failed();
  validPublicPath(variant.publicPath);
  if (!variant.publicPath.endsWith(`/${kind.toLowerCase()}.webp`)) failed();
}
function validPublicPath(path: string): void { if (!PUBLIC_PATH.test(path) || path.includes("..")) failed(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function failed(): never { throw new GalleryPublicationStorageError(); }
