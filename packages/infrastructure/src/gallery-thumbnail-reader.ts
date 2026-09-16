const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;
const SIGNED_PATH_PREFIX = "/storage/v1/object/sign/gallery-private/";

export class GalleryThumbnailUnavailableError extends Error { readonly code = "GALLERY_THUMBNAIL_UNAVAILABLE"; constructor() { super("Gallery thumbnail unavailable"); } }
export interface GalleryThumbnailSigner { sign(path: string, expiresInSeconds: number): Promise<string>; }
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class GalleryThumbnailReader {
  private readonly allowedOrigin: string;
  constructor(private readonly signer: GalleryThumbnailSigner, allowedStorageUrl: string, private readonly fetcher: Fetcher = fetch, private readonly timeoutMs = 3_000) {
    try { this.allowedOrigin = new URL(allowedStorageUrl).origin; } catch { throw new GalleryThumbnailUnavailableError(); }
  }

  async read(path: string, persistedByteSize: number): Promise<{ bytes: Uint8Array; contentType: "image/webp" }> {
    if (!Number.isInteger(persistedByteSize) || persistedByteSize < 1 || persistedByteSize > MAX_THUMBNAIL_BYTES) throw new GalleryThumbnailUnavailableError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const signed = new URL(await this.signer.sign(path, 30));
      if (signed.origin !== this.allowedOrigin || !signed.pathname.startsWith(SIGNED_PATH_PREFIX)) throw new GalleryThumbnailUnavailableError();
      const response = await this.fetcher(signed.toString(), { method: "GET", redirect: "error", signal: controller.signal, headers: { Accept: "image/webp" } });
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      const declared = response.headers.get("Content-Length");
      if (!response.ok || contentType !== "image/webp" || (declared !== null && Number(declared) !== persistedByteSize) || !response.body) throw new GalleryThumbnailUnavailableError();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
      while (true) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > persistedByteSize) { await reader.cancel(); throw new GalleryThumbnailUnavailableError(); } chunks.push(chunk.value); }
      if (total !== persistedByteSize) throw new GalleryThumbnailUnavailableError();
      const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, contentType: "image/webp" };
    } catch (error) { if (error instanceof GalleryThumbnailUnavailableError) throw error; throw new GalleryThumbnailUnavailableError(); }
    finally { clearTimeout(timer); }
  }
}
