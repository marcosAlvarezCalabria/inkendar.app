import { describe, expect, it, vi } from "vitest";
import {
  GalleryPublicationFailedError,
  createGalleryPublicationService,
  type GalleryPublicationRepositoryPort,
  type GalleryPublicationStoragePort,
} from "./gallery-publication.js";

const handle = "90000000-0000-4000-8000-000000000001";
const publicationKey = "70000000-0000-4000-8000-000000000001";
const display = { kind: "DISPLAY" as const, privatePath: "20000000-0000-4000-8000-000000000001/60000000-0000-4000-8000-000000000001/display.webp", publicPath: `${publicationKey}/display.webp`, mimeType: "image/webp" as const, byteSize: 3 };
const thumb = { kind: "THUMB" as const, privatePath: "20000000-0000-4000-8000-000000000001/60000000-0000-4000-8000-000000000001/thumb.webp", publicPath: `${publicationKey}/thumb.webp`, mimeType: "image/webp" as const, byteSize: 2 };

describe("gallery publication service", () => {
  it("begins before lazy Storage composition, copies only DISPLAY/THUMB, then finalizes exact binding", async () => {
    const order: string[] = [];
    const repository = repositoryWith({
      beginPublish: vi.fn(async () => { order.push("begin"); return { outcome: "WORK" as const, publicationKey, variants: [display, thumb] }; }),
      finalizePublish: vi.fn(async () => { order.push("finalize"); }),
    });
    const storage = storageWith({
      readPrivate: vi.fn(async (variant) => { order.push(`read:${variant.kind}`); return variant.kind === "DISPLAY" ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5]); }),
      uploadPublic: vi.fn(async (path) => { order.push(`upload:${path}`); }),
    });
    const createStorage = vi.fn(() => { order.push("compose-storage"); return storage; });

    await createGalleryPublicationService(repository, createStorage).publish(handle);

    expect(order).toEqual(["begin", "compose-storage", "read:DISPLAY", `upload:${display.publicPath}`, "read:THUMB", `upload:${thumb.publicPath}`, "finalize"]);
    expect(storage.readPrivate).toHaveBeenCalledTimes(2);
    expect(storage.uploadPublic).toHaveBeenNthCalledWith(1, display.publicPath, new Uint8Array([1, 2, 3]));
    expect(repository.finalizePublish).toHaveBeenCalledWith(handle, publicationKey);
    expect(JSON.stringify(vi.mocked(storage.readPrivate).mock.calls)).not.toContain("master.webp");
  });

  it("leaves PUBLISHING retryable after ambiguous upload and reuses the same binding", async () => {
    const repository = repositoryWith({ beginPublish: vi.fn().mockResolvedValue({ outcome: "WORK", publicationKey, variants: [display, thumb] }) });
    const uploadPublic = vi.fn().mockRejectedValueOnce(new Error("provider/path")).mockResolvedValue(undefined);
    const storage = storageWith({ readPrivate: vi.fn().mockImplementation(async (variant) => new Uint8Array(variant.byteSize)), uploadPublic });
    const service = createGalleryPublicationService(repository, () => storage);

    await expect(service.publish(handle)).rejects.toBeInstanceOf(GalleryPublicationFailedError);
    expect(repository.finalizePublish).not.toHaveBeenCalled();
    await service.publish(handle);

    expect(repository.beginPublish).toHaveBeenCalledTimes(2);
    expect(repository.finalizePublish).toHaveBeenCalledWith(handle, publicationKey);
    expect(new Set(uploadPublic.mock.calls.map((call) => call[0]))).toEqual(new Set([display.publicPath, thumb.publicPath]));
  });

  it("converges without Storage when publish already finalized after a lost response", async () => {
    let finalized = false;
    const beginPublish = vi.fn(async () => finalized ? { outcome: "COMPLETE" as const } : { outcome: "WORK" as const, publicationKey, variants: [display, thumb] });
    const finalizePublish = vi.fn(async () => { finalized = true; throw new Error("response lost after commit"); });
    const repository = repositoryWith({ beginPublish, finalizePublish });
    const storage = storageWith({ readPrivate: vi.fn().mockImplementation(async (variant) => new Uint8Array(variant.byteSize)), uploadPublic: vi.fn().mockResolvedValue(undefined) });
    const createStorage = vi.fn(() => storage);
    const service = createGalleryPublicationService(repository, createStorage);
    await expect(service.publish(handle)).rejects.toBeInstanceOf(GalleryPublicationFailedError);
    await service.publish(handle);
    expect(beginPublish).toHaveBeenCalledTimes(2);
    expect(finalizePublish).toHaveBeenCalledTimes(1);
    expect(createStorage).toHaveBeenCalledTimes(1);
    expect(storage.uploadPublic).toHaveBeenCalledTimes(2);
  });

  it("retires through begin, idempotent public removal, and exact finalize without private deletion", async () => {
    const repository = repositoryWith({ beginRetire: vi.fn().mockResolvedValue({ outcome: "WORK", publicationKey, publicPaths: [display.publicPath, thumb.publicPath] }) });
    const storage = storageWith();
    await createGalleryPublicationService(repository, () => storage).retire(handle);
    expect(storage.removePublic).toHaveBeenCalledWith([display.publicPath, thumb.publicPath]);
    expect(storage.readPrivate).not.toHaveBeenCalled();
    expect(repository.finalizeRetire).toHaveBeenCalledWith(handle, publicationKey);
  });

  it("leaves RETIRING retryable on ambiguous remove and converges without Storage once RETIRED", async () => {
    const beginRetire = vi.fn()
      .mockResolvedValueOnce({ outcome: "WORK", publicationKey, publicPaths: [display.publicPath, thumb.publicPath] })
      .mockResolvedValueOnce({ outcome: "COMPLETE" });
    const repository = repositoryWith({ beginRetire });
    const storage = storageWith({ removePublic: vi.fn().mockRejectedValue(new Error("ambiguous provider response")) });
    const createStorage = vi.fn(() => storage);
    const service = createGalleryPublicationService(repository, createStorage);
    await expect(service.retire(handle)).rejects.toBeInstanceOf(GalleryPublicationFailedError);
    expect(repository.finalizeRetire).not.toHaveBeenCalled();
    await service.retire(handle);
    expect(createStorage).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed or MASTER-bearing begin plan before Storage composition", async () => {
    const repository = repositoryWith({ beginPublish: vi.fn().mockResolvedValue({ outcome: "WORK", publicationKey, variants: [{ ...display, kind: "MASTER", privatePath: display.privatePath.replace("display", "master"), publicPath: display.publicPath.replace("display", "master") }, thumb] }) });
    const createStorage = vi.fn();
    await expect(createGalleryPublicationService(repository, createStorage).publish(handle)).rejects.toBeInstanceOf(GalleryPublicationFailedError);
    expect(createStorage).not.toHaveBeenCalled();
  });
});

function repositoryWith(overrides: Partial<GalleryPublicationRepositoryPort> = {}): GalleryPublicationRepositoryPort {
  return {
    beginPublish: vi.fn(), finalizePublish: vi.fn(), beginRetire: vi.fn(), finalizeRetire: vi.fn(), ...overrides,
  };
}

function storageWith(overrides: Partial<GalleryPublicationStoragePort> = {}): GalleryPublicationStoragePort {
  return { readPrivate: vi.fn(), uploadPublic: vi.fn(), removePublic: vi.fn(), ...overrides };
}
