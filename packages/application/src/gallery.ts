import { InvalidGalleryInputError, normalizeGalleryDraftInput, type GalleryTarget } from "@inkendar/domain";

export { InvalidGalleryInputError } from "@inkendar/domain";
export type GalleryVariantKind = "MASTER" | "DISPLAY" | "THUMB";
export type GalleryProcessedVariant = Readonly<{ kind: GalleryVariantKind; bytes: Uint8Array; width: number; height: number; mimeType: "image/webp" }>;
export type ProcessedGalleryImage = Readonly<{ sourceFormat: "jpeg" | "png" | "webp"; width: number; height: number; variants: readonly GalleryProcessedVariant[] }>;
export type GalleryDraftRecord = Readonly<{ id: string; studioId: string; target: GalleryTarget; artistProfileId: string | null; altText: string; variants: readonly { kind: GalleryVariantKind; path: string; width: number; height: number; mimeType: "image/webp"; byteSize: number }[] }>;
export type GalleryDraftRow = Readonly<{ publicId: string; target: GalleryTarget; artistDisplayName: string | null; altText: string; position: number; width: number; height: number; thumbPath: string }>;
export type GalleryDraftView = Omit<GalleryDraftRow, "thumbPath"> & Readonly<{ thumbnailUrl: string }>;

export interface GalleryImageProcessorPort { process(bytes: Uint8Array): Promise<ProcessedGalleryImage>; }
export interface PrivateGalleryStoragePort { upload(path: string, object: Readonly<{ bytes: Uint8Array; contentType: "image/webp" }>): Promise<void>; remove(paths: readonly string[]): Promise<void>; sign(path: string, expiresInSeconds: number): Promise<string>; }
export interface GalleryRepositoryPort { createDraft(record: GalleryDraftRecord): Promise<{ id: string }>; listDrafts(studioId: string, limit: number): Promise<readonly GalleryDraftRow[]>; }

export class GalleryIngestionFailedError extends Error { readonly code = "GALLERY_INGESTION_FAILED"; constructor() { super("Gallery ingestion failed"); } }

export function createGalleryService(deps: Readonly<{ processor: GalleryImageProcessorPort; storage: PrivateGalleryStoragePort; repository: GalleryRepositoryPort; createId: () => string }>) {
  return {
    async ingest(input: Readonly<{ studioId: string; bytes: Uint8Array; altText: string; target: unknown; artistProfileId: string | null }>): Promise<void> {
      const studioId = resourceId(input.studioId);
      const draft = normalizeGalleryDraftInput({ altText: input.altText, target: input.target, artistProfileId: input.artistProfileId });
      const id = resourceId(deps.createId());
      let processed: ProcessedGalleryImage;
      try { processed = await deps.processor.process(input.bytes); }
      catch (error) { if (error instanceof InvalidGalleryInputError) throw error; throw new GalleryIngestionFailedError(); }
      const variants = processed.variants.map((variant) => ({ kind: variant.kind, path: `${studioId}/${id}/${variant.kind.toLowerCase()}.webp`, width: variant.width, height: variant.height, mimeType: variant.mimeType, byteSize: variant.bytes.byteLength, bytes: variant.bytes }));
      if (variants.length !== 3 || new Set(variants.map((variant) => variant.kind)).size !== 3) throw new GalleryIngestionFailedError();
      try {
        for (const variant of variants) await deps.storage.upload(variant.path, { bytes: variant.bytes, contentType: variant.mimeType });
        await deps.repository.createDraft({ id, studioId, ...draft, variants: variants.map((variant) => ({ kind: variant.kind, path: variant.path, width: variant.width, height: variant.height, mimeType: variant.mimeType, byteSize: variant.byteSize })) });
      } catch {
        try { await deps.storage.remove(variants.map((variant) => variant.path)); } catch { /* private orphan remains eligible for reconciliation */ }
        throw new GalleryIngestionFailedError();
      }
    },
    async list(studioIdInput: string): Promise<readonly GalleryDraftView[]> {
      const studioId = resourceId(studioIdInput);
      const drafts = await deps.repository.listDrafts(studioId, 100);
      return Promise.all(drafts.map(async ({ thumbPath, ...draft }) => ({ ...draft, thumbnailUrl: await deps.storage.sign(thumbPath, 60) })));
    },
  };
}

function resourceId(value: string): string { if (!UUID.test(value)) throw new InvalidGalleryInputError(); return value; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
