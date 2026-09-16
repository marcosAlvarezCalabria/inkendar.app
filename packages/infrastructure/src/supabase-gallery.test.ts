import { describe, expect, it, vi } from "vitest";
import { SupabaseGalleryRepository, SupabasePrivateGalleryStorage } from "./supabase-gallery.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const assetId = "60000000-0000-4000-8000-000000000001";

describe("Supabase gallery adapters", () => {
  it("uses auth-bound RPC parameters without a caller-provided owner identity", async () => {
    const data = gatewayWith({ createDraft: vi.fn().mockResolvedValue({ data: assetId, error: null }), listDrafts: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const repository = new SupabaseGalleryRepository(data);
    await repository.createDraft({ id: assetId, studioId, target: "GALLERY", artistProfileId: null, altText: "Pieza", variants: [
      { kind: "MASTER", path: `${studioId}/${assetId}/master.webp`, width: 10, height: 20, mimeType: "image/webp", byteSize: 30 },
      { kind: "DISPLAY", path: `${studioId}/${assetId}/display.webp`, width: 10, height: 20, mimeType: "image/webp", byteSize: 20 },
      { kind: "THUMB", path: `${studioId}/${assetId}/thumb.webp`, width: 10, height: 20, mimeType: "image/webp", byteSize: 10 },
    ] });
    const parameters = data.createDraft.mock.calls[0]![0];
    expect(parameters).toMatchObject({ p_studio_id: studioId, p_asset_id: assetId, p_target: "GALLERY" });
    expect(Object.keys(parameters).join(" ")).not.toMatch(/owner|user/i);
  });

  it("maps opaque thumbnail handles and resolves paths only on demand", async () => {
    const handle = "90000000-0000-4000-8000-000000000001";
    const data = gatewayWith({ listDrafts: vi.fn().mockResolvedValue({ data: [{ thumbnail_handle: handle, status: "DRAFT", target: "GALLERY", artist_profile_id: null, artist_display_name: null, alt_text: "Pieza", position: 1, width: 480, height: 320 }], error: null }), resolveThumbnail: vi.fn().mockResolvedValue({ data: [{ object_path: `${studioId}/${assetId}/thumb.webp`, byte_size: 10 }], error: null }) });
    const repository = new SupabaseGalleryRepository(data);
    await expect(repository.listDrafts(studioId, 100)).resolves.toEqual([expect.objectContaining({ thumbnailHandle: handle })]);
    await expect(repository.resolveThumbnail(handle)).resolves.toEqual({ path: `${studioId}/${assetId}/thumb.webp`, byteSize: 10 });
    expect(data.resolveThumbnail).toHaveBeenCalledWith({ p_handle: handle });
  });

  it("curates drafts through handle-only auth-bound RPC parameters", async () => {
    const handle = "90000000-0000-4000-8000-000000000001";
    const artistProfileId = "50000000-0000-4000-8000-000000000001";
    const data = gatewayWith({
      updateDraft: vi.fn().mockResolvedValue({ data: null, error: null }),
      moveDraft: vi.fn().mockResolvedValue({ data: null, error: null }),
      discardDraft: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const repository = new SupabaseGalleryRepository(data);
    await repository.updateDraft(handle, { altText: "Pieza", target: "ARTIST_PORTFOLIO", artistProfileId });
    await repository.moveDraft(handle, "MOVE_DOWN");
    await repository.discardDraft(handle);
    expect(data.updateDraft).toHaveBeenCalledWith({ p_handle: handle, p_alt_text: "Pieza", p_target: "ARTIST_PORTFOLIO", p_artist_profile_id: artistProfileId });
    expect(data.moveDraft).toHaveBeenCalledWith({ p_handle: handle, p_direction: "MOVE_DOWN" });
    expect(data.discardDraft).toHaveBeenCalledWith({ p_handle: handle });
    expect(JSON.stringify([data.updateDraft.mock.calls, data.moveDraft.mock.calls, data.discardDraft.mock.calls])).not.toMatch(/studio|user|asset|path|status/i);
  });

  it("keeps the bucket private boundary and bounds signed URL expiry", async () => {
    const gateway = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), sign: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null }) };
    const storage = new SupabasePrivateGalleryStorage(gateway);
    await storage.upload(`${studioId}/${assetId}/thumb.webp`, { bytes: new Uint8Array([1]), contentType: "image/webp" });
    await expect(storage.sign(`${studioId}/${assetId}/thumb.webp`, 60)).resolves.toContain("signed");
    await expect(storage.sign(`${studioId}/${assetId}/thumb.webp`, 301)).rejects.toThrow("Gallery storage failed");
  });
});

function gatewayWith(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return { createDraft: vi.fn(), listDrafts: vi.fn(), resolveThumbnail: vi.fn(), updateDraft: vi.fn(), moveDraft: vi.fn(), discardDraft: vi.fn(), ...overrides };
}
