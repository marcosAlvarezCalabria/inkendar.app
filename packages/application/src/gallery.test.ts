import { describe, expect, it, vi } from "vitest";
import { GalleryIngestionFailedError, createGalleryService, type GalleryImageProcessorPort, type GalleryRepositoryPort, type PrivateGalleryStoragePort } from "./gallery.js";

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
    const repository: GalleryRepositoryPort = { createDraft: vi.fn().mockResolvedValue({ id: assetId }), listDrafts: vi.fn() };
    const service = createGalleryService({ processor, storage, repository, createId: () => assetId });
    await service.ingest({ studioId, bytes: new Uint8Array([255, 216, 255]), altText: "  Tatuaje floral ", target: "GALLERY", artistProfileId: null });
    expect(storage.upload).toHaveBeenCalledTimes(3);
    expect(storage.upload).toHaveBeenNthCalledWith(1, `${studioId}/${assetId}/master.webp`, expect.objectContaining({ contentType: "image/webp", bytes: processed.variants[0]!.bytes }));
    expect(repository.createDraft).toHaveBeenCalledWith(expect.objectContaining({ studioId, id: assetId, altText: "Tatuaje floral", target: "GALLERY", artistProfileId: null }));
  });

  it("compensates every attempted object and never persists after an upload failure", async () => {
    const repository: GalleryRepositoryPort = { createDraft: vi.fn(), listDrafts: vi.fn() };
    const storage: PrivateGalleryStoragePort = { upload: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider/path.jpg")), remove: vi.fn().mockResolvedValue(undefined), sign: vi.fn() };
    const service = createGalleryService({ processor: { process: vi.fn().mockResolvedValue(processed) }, storage, repository, createId: () => assetId });
    await expect(service.ingest({ studioId, bytes: new Uint8Array([1]), altText: "válido", target: "GALLERY", artistProfileId: null })).rejects.toBeInstanceOf(GalleryIngestionFailedError);
    expect(repository.createDraft).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(processed.variants.map((variant) => `${studioId}/${assetId}/${variant.kind.toLowerCase()}.webp`));
  });

  it("compensates uploads when persistence rejects a cross-tenant artist", async () => {
    const storage: PrivateGalleryStoragePort = { upload: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), sign: vi.fn() };
    const repository: GalleryRepositoryPort = { createDraft: vi.fn().mockRejectedValue(new Error("tenant path leaked")), listDrafts: vi.fn() };
    const service = createGalleryService({ processor: { process: vi.fn().mockResolvedValue(processed) }, storage, repository, createId: () => assetId });
    await expect(service.ingest({ studioId, bytes: new Uint8Array([1]), altText: "válido", target: "ARTIST_PORTFOLIO", artistProfileId: "50000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ message: "Gallery ingestion failed" });
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("signs only bounded thumbnail paths returned by the repository", async () => {
    const repository: GalleryRepositoryPort = { createDraft: vi.fn(), listDrafts: vi.fn().mockResolvedValue([{ publicId: "draft_public", target: "GALLERY", artistDisplayName: null, altText: "Pieza", position: 1, width: 480, height: 320, thumbPath: `${studioId}/${assetId}/thumb.webp` }]) };
    const storage: PrivateGalleryStoragePort = { upload: vi.fn(), remove: vi.fn(), sign: vi.fn().mockResolvedValue("https://storage.example/signed") };
    const service = createGalleryService({ processor: { process: vi.fn() }, storage, repository, createId: () => assetId });
    const list = await service.list(studioId);
    expect(repository.listDrafts).toHaveBeenCalledWith(studioId, 100);
    expect(storage.sign).toHaveBeenCalledWith(`${studioId}/${assetId}/thumb.webp`, 60);
    expect(list[0]).not.toHaveProperty("thumbPath");
  });
});
