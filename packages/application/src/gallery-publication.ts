import { InvalidGalleryInputError } from "@inkendar/domain";

export type GalleryLifecycleStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED" | "RETIRING";
export type GalleryPublishVariant = Readonly<{
  kind: "DISPLAY" | "THUMB";
  privatePath: string;
  publicPath: string;
  mimeType: "image/webp";
  byteSize: number;
}>;
export type GalleryPublishBegin = Readonly<{ outcome: "COMPLETE" }> | Readonly<{ outcome: "WORK"; publicationKey: string; variants: readonly GalleryPublishVariant[] }>;
export type GalleryRetireBegin = Readonly<{ outcome: "COMPLETE" }> | Readonly<{ outcome: "WORK"; publicationKey: string; publicPaths: readonly string[] }>;

export interface GalleryPublicationRepositoryPort {
  beginPublish(handle: string): Promise<GalleryPublishBegin>;
  finalizePublish(handle: string, publicationKey: string): Promise<void>;
  beginRetire(handle: string): Promise<GalleryRetireBegin>;
  finalizeRetire(handle: string, publicationKey: string): Promise<void>;
}

export interface GalleryPublicationStoragePort {
  readPrivate(variant: GalleryPublishVariant): Promise<Uint8Array>;
  uploadPublic(path: string, bytes: Uint8Array): Promise<void>;
  removePublic(paths: readonly string[]): Promise<void>;
}

export class GalleryPublicationFailedError extends Error {
  readonly code = "GALLERY_PUBLICATION_FAILED";
  constructor() { super("Gallery publication lifecycle failed"); }
}

export function createGalleryPublicationService(repository: GalleryPublicationRepositoryPort, createStorage: () => GalleryPublicationStoragePort) {
  return {
    async publish(handleInput: string): Promise<void> {
      const handle = resourceId(handleInput);
      try {
        const begin = await repository.beginPublish(handle);
        if (begin.outcome === "COMPLETE") return;
        const variants = validPublishPlan(begin);
        const storage = createStorage();
        for (const variant of variants) {
          const bytes = await storage.readPrivate(variant);
          await storage.uploadPublic(variant.publicPath, bytes);
        }
        await repository.finalizePublish(handle, begin.publicationKey);
      } catch (error) {
        if (error instanceof InvalidGalleryInputError) throw error;
        throw new GalleryPublicationFailedError();
      }
    },

    async retire(handleInput: string): Promise<void> {
      const handle = resourceId(handleInput);
      try {
        const begin = await repository.beginRetire(handle);
        if (begin.outcome === "COMPLETE") return;
        const paths = validRetirePlan(begin);
        const storage = createStorage();
        await storage.removePublic(paths);
        await repository.finalizeRetire(handle, begin.publicationKey);
      } catch (error) {
        if (error instanceof InvalidGalleryInputError) throw error;
        throw new GalleryPublicationFailedError();
      }
    },
  };
}

function validPublishPlan(begin: Extract<GalleryPublishBegin, { outcome: "WORK" }>): readonly GalleryPublishVariant[] {
  const key = resourceId(begin.publicationKey);
  if (begin.variants.length !== 2) throw new GalleryPublicationFailedError();
  const byKind = new Map(begin.variants.map((variant) => [variant.kind, variant]));
  if (byKind.size !== 2 || !byKind.has("DISPLAY") || !byKind.has("THUMB")) throw new GalleryPublicationFailedError();
  const result = [byKind.get("DISPLAY")!, byKind.get("THUMB")!];
  for (const variant of result) {
    const lowerKind = variant.kind.toLowerCase();
    if (variant.mimeType !== "image/webp" || !Number.isInteger(variant.byteSize) || variant.byteSize < 1 || variant.byteSize > MAX_BYTES) throw new GalleryPublicationFailedError();
    if (!PRIVATE_PATH.test(variant.privatePath) || !variant.privatePath.endsWith(`/${lowerKind}.webp`)) throw new GalleryPublicationFailedError();
    if (variant.publicPath !== `${key}/${lowerKind}.webp`) throw new GalleryPublicationFailedError();
  }
  return result;
}

function validRetirePlan(begin: Extract<GalleryRetireBegin, { outcome: "WORK" }>): readonly string[] {
  const key = resourceId(begin.publicationKey);
  const expected = [`${key}/display.webp`, `${key}/thumb.webp`];
  if (begin.publicPaths.length !== 2 || expected.some((path) => !begin.publicPaths.includes(path))) throw new GalleryPublicationFailedError();
  return expected;
}

function resourceId(value: string): string { if (!UUID.test(value)) throw new InvalidGalleryInputError(); return value; }
const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRIVATE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(display|thumb)\.webp$/iu;
