import { InvalidGalleryInputError, normalizeGalleryDraftInput, type GalleryTarget } from "@inkendar/domain";

export { InvalidGalleryInputError } from "@inkendar/domain";
export type GalleryVariantKind = "MASTER" | "DISPLAY" | "THUMB";
export type GalleryProcessedVariant = Readonly<{ kind: GalleryVariantKind; bytes: Uint8Array; width: number; height: number; mimeType: "image/webp" }>;
export type ProcessedGalleryImage = Readonly<{ sourceFormat: "jpeg" | "png" | "webp"; width: number; height: number; variants: readonly GalleryProcessedVariant[] }>;
export type GalleryDraftRecord = Readonly<{ id: string; studioId: string; target: GalleryTarget; artistProfileId: string | null; altText: string; variants: readonly { kind: GalleryVariantKind; path: string; width: number; height: number; mimeType: "image/webp"; byteSize: number }[] }>;
export type GalleryDraftRow = Readonly<{ thumbnailHandle: string; status: "DRAFT" | "PUBLISHING" | "PUBLISHED" | "RETIRING"; target: GalleryTarget; artistProfileId: string | null; artistDisplayName: string | null; altText: string; position: number; width: number; height: number }>;
export type GalleryDraftView = GalleryDraftRow;
export type GalleryMoveDirection = "MOVE_UP" | "MOVE_DOWN";

export interface GalleryImageProcessorPort { process(bytes: Uint8Array): Promise<ProcessedGalleryImage>; }
export interface PrivateGalleryStoragePort { upload(path: string, object: Readonly<{ bytes: Uint8Array; contentType: "image/webp" }>): Promise<void>; remove(paths: readonly string[]): Promise<void>; sign(path: string, expiresInSeconds: number): Promise<string>; }
export interface GalleryRepositoryPort {
  createDraft(record: GalleryDraftRecord): Promise<{ id: string }>;
  listDrafts(studioId: string, limit: number): Promise<readonly GalleryDraftRow[]>;
  resolveThumbnail(handle: string): Promise<{ path: string; byteSize: number }>;
  updateDraft(handle: string, input: Readonly<{ altText: string; target: GalleryTarget; artistProfileId: string | null }>): Promise<void>;
  moveDraft(handle: string, direction: GalleryMoveDirection): Promise<void>;
  discardDraft(handle: string): Promise<void>;
}

export class GalleryIngestionFailedError extends Error { readonly code = "GALLERY_INGESTION_FAILED"; constructor() { super("Gallery ingestion failed"); } }
export class GalleryMutationFailedError extends Error { readonly code = "GALLERY_MUTATION_FAILED"; constructor() { super("Gallery mutation failed"); } }

export function createGalleryCurationService(repository: GalleryRepositoryPort) {
  return {
    async list(studioIdInput: string): Promise<readonly GalleryDraftView[]> {
      const studioId = resourceId(studioIdInput);
      return repository.listDrafts(studioId, 100);
    },
    async update(input: Readonly<{ handle: string; altText: string; target: unknown; artistProfileId: string | null }>): Promise<void> {
      const handle = resourceId(input.handle);
      const draft = normalizeGalleryDraftInput(input);
      try { await repository.updateDraft(handle, draft); }
      catch { throw new GalleryMutationFailedError(); }
    },
    async move(handleInput: string, direction: GalleryMoveDirection): Promise<void> {
      const handle = resourceId(handleInput);
      if (direction !== "MOVE_UP" && direction !== "MOVE_DOWN") throw new InvalidGalleryInputError();
      try { await repository.moveDraft(handle, direction); }
      catch { throw new GalleryMutationFailedError(); }
    },
    async discard(handleInput: string): Promise<void> {
      const handle = resourceId(handleInput);
      try { await repository.discardDraft(handle); }
      catch { throw new GalleryMutationFailedError(); }
    },
  };
}

export function createGalleryService(deps: Readonly<{ processor: GalleryImageProcessorPort; storage: PrivateGalleryStoragePort; repository: GalleryRepositoryPort; createId: () => string }>) {
  const curation = createGalleryCurationService(deps.repository);
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
    ...curation,
  };
}

function resourceId(value: string): string { if (!UUID.test(value)) throw new InvalidGalleryInputError(); return value; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
