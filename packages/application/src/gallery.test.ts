import { describe, expect, it, vi } from "vitest";
import { GalleryIngestionFailedError, GalleryMutationFailedError, InvalidGalleryInputError, createGalleryService, type GalleryImageProcessorPort, type GalleryRepositoryPort, type PrivateGalleryStoragePort } from "./gallery.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const assetId = "60000000-0000-4000-8000-000000000001";
const processed = { sourceFormat: "jpeg" as const, width: 1200, height: 800, variants: [
  { kind: "MASTER" as const, bytes: new Uint8Array([1]), width: 1200, height: 800, mimeType: "image/webp" as const },
  { kind: "DISPLAY" as const, bytes: new Uint8Array([2]), width: 1200, height: 800, mimeType: "image/webp" as const },
  { kind: "THUMB" as const, bytes: new Uint8Array([3]), width: 480, height: 320, mimeType: "image/webp" as const },
] };

describe("gallery service", () => {
  it("uploads opaque tenant-scoped variants before saving a draft", async () => {
    const processor: GalleryImageProcessorPort = { process: vi.fn().mockResolvedValue(processed) };
    const storage: PrivateGalleryStoragePort = { upload: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), sign: vi.fn() };
    const repository: GalleryRepositoryPort = repositoryWith({ createDraft: vi.fn().mockResolvedValue({ id: assetId }) });
    const service = createGalleryService({ processor, storage, repository, createId: () => assetId });
    await service.ingest({ studioId, bytes: new Uint8Array([255, 216, 255]), altText: "  Tatuaje floral ", target: "GALLERY", artistProfileId: null });
    expect(storage.upload).toHaveBeenCalledTimes(3);
    expect(storage.upload).toHaveBeenNthCalledWith(1, `${studioId}/${assetId}/master.webp`, expect.objectContaining({ contentType: "image/webp", bytes: processed.variants[0]!.bytes }));
    expect(repository.createDraft).toHaveBeenCalledWith(expect.objectContaining({ studioId, id: assetId, altText: "Tatuaje floral", target: "GALLERY", artistProfileId: null }));
  });

  it("compensates every attempted object and never persists after an upload failure", async () => {
    const repository: GalleryRepositoryPort = repositoryWith();
    const storage: PrivateGalleryStoragePort = { upload: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider/path.jpg")), remove: vi.fn().mockResolvedValue(undefined), sign: vi.fn() };
    const service = createGalleryService({ processor: { process: vi.fn().mockResolvedValue(processed) }, storage, repository, createId: () => assetId });
    await expect(service.ingest({ studioId, bytes: new Uint8Array([1]), altText: "válido", target: "GALLERY", artistProfileId: null })).rejects.toBeInstanceOf(GalleryIngestionFailedError);
    expect(repository.createDraft).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(processed.variants.map((variant) => `${studioId}/${assetId}/${variant.kind.toLowerCase()}.webp`));
  });

  it("compensates uploads when persistence rejects a cross-tenant artist", async () => {
    const storage: PrivateGalleryStoragePort = { upload: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), sign: vi.fn() };
    const repository: GalleryRepositoryPort = repositoryWith({ createDraft: vi.fn().mockRejectedValue(new Error("tenant path leaked")) });
    const service = createGalleryService({ processor: { process: vi.fn().mockResolvedValue(processed) }, storage, repository, createId: () => assetId });
    await expect(service.ingest({ studioId, bytes: new Uint8Array([1]), altText: "válido", target: "ARTIST_PORTFOLIO", artistProfileId: "50000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ message: "Gallery ingestion failed" });
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("lists only opaque thumbnail handles without signing URLs", async () => {
    const repository: GalleryRepositoryPort = repositoryWith({ listDrafts: vi.fn().mockResolvedValue([{ thumbnailHandle: "90000000-0000-4000-8000-000000000001", target: "GALLERY", artistProfileId: null, artistDisplayName: null, altText: "Pieza", position: 1, width: 480, height: 320 }]) });
    const storage: PrivateGalleryStoragePort = { upload: vi.fn(), remove: vi.fn(), sign: vi.fn() };
    const service = createGalleryService({ processor: { process: vi.fn() }, storage, repository, createId: () => assetId });
    const list = await service.list(studioId);
    expect(repository.listDrafts).toHaveBeenCalledWith(studioId, 100);
    expect(storage.sign).not.toHaveBeenCalled();
    expect(list).toEqual([expect.objectContaining({ thumbnailHandle: "90000000-0000-4000-8000-000000000001" })]);
  });

  it("edits a draft by opaque handle and normalizes metadata without browser tenant identity", async () => {
    const handle = "90000000-0000-4000-8000-000000000001";
    const artistProfileId = "50000000-0000-4000-8000-000000000001";
    const repository = repositoryWith();
    const service = createGalleryService({ processor: { process: vi.fn() }, storage: storageWith(), repository, createId: () => assetId });
    await service.update({ handle, altText: "  Pieza   geométrica\n fina ", target: "ARTIST_PORTFOLIO", artistProfileId });
    expect(repository.updateDraft).toHaveBeenCalledWith(handle, { altText: "Pieza geométrica fina", target: "ARTIST_PORTFOLIO", artistProfileId });
    expect(JSON.stringify(vi.mocked(repository.updateDraft).mock.calls)).not.toMatch(/studioId|userId|assetId|path|status/);
  });

  it.each(["MOVE_UP", "MOVE_DOWN"] as const)("moves a draft using the %s intention", async (direction) => {
    const handle = "90000000-0000-4000-8000-000000000001";
    const repository = repositoryWith();
    const service = createGalleryService({ processor: { process: vi.fn() }, storage: storageWith(), repository, createId: () => assetId });
    await service.move(handle, direction);
    expect(repository.moveDraft).toHaveBeenCalledWith(handle, direction);
  });

  it("discards a draft without touching private storage", async () => {
    const handle = "90000000-0000-4000-8000-000000000001";
    const repository = repositoryWith();
    const storage = storageWith();
    const service = createGalleryService({ processor: { process: vi.fn() }, storage, repository, createId: () => assetId });
    await service.discard(handle);
    expect(repository.discardDraft).toHaveBeenCalledWith(handle);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects invalid handles before persistence and maps repository detail to a generic mutation failure", async () => {
    const repository = repositoryWith({ updateDraft: vi.fn().mockRejectedValue(new Error("foreign tenant/private/path")) });
    const service = createGalleryService({ processor: { process: vi.fn() }, storage: storageWith(), repository, createId: () => assetId });
    await expect(service.move("not-a-handle", "MOVE_UP")).rejects.toBeInstanceOf(InvalidGalleryInputError);
    expect(repository.moveDraft).not.toHaveBeenCalled();
    await expect(service.update({ handle: "90000000-0000-4000-8000-000000000001", altText: "Pieza", target: "GALLERY", artistProfileId: null })).rejects.toEqual(new GalleryMutationFailedError());
  });
});

function repositoryWith(overrides: Partial<GalleryRepositoryPort> = {}): GalleryRepositoryPort {
  return { createDraft: vi.fn(), listDrafts: vi.fn(), resolveThumbnail: vi.fn(), updateDraft: vi.fn(), moveDraft: vi.fn(), discardDraft: vi.fn(), ...overrides };
}

function storageWith(): PrivateGalleryStoragePort {
  return { upload: vi.fn(), remove: vi.fn(), sign: vi.fn() };
}
