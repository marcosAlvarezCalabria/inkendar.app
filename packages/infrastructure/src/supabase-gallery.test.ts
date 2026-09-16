import { describe, expect, it, vi } from "vitest";
import { SupabaseGalleryRepository, SupabasePrivateGalleryStorage } from "./supabase-gallery.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const assetId = "60000000-0000-4000-8000-000000000001";

describe("Supabase gallery adapters", () => {
  it("uses auth-bound RPC parameters without a caller-provided owner identity", async () => {
    const data = { createDraft: vi.fn().mockResolvedValue({ data: assetId, error: null }), listDrafts: vi.fn().mockResolvedValue({ data: [], error: null }) };
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

  it("maps a bounded ordered list and rejects foreign thumbnail paths", async () => {
    const data = { createDraft: vi.fn(), listDrafts: vi.fn().mockResolvedValue({ data: [{ public_id: "public-safe", target: "GALLERY", artist_display_name: null, alt_text: "Pieza", position: 1, width: 480, height: 320, thumb_path: `${studioId}/${assetId}/thumb.webp` }], error: null }) };
    const repository = new SupabaseGalleryRepository(data);
    await expect(repository.listDrafts(studioId, 100)).resolves.toHaveLength(1);
    data.listDrafts.mockResolvedValueOnce({ data: [{ public_id: "x", target: "GALLERY", artist_display_name: null, alt_text: "Pieza", position: 1, width: 1, height: 1, thumb_path: `other/${assetId}/thumb.webp` }], error: null });
    await expect(repository.listDrafts(studioId, 100)).rejects.toThrow("Gallery persistence failed");
  });

  it("keeps the bucket private boundary and bounds signed URL expiry", async () => {
    const gateway = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), sign: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null }) };
    const storage = new SupabasePrivateGalleryStorage(gateway);
    await storage.upload(`${studioId}/${assetId}/thumb.webp`, { bytes: new Uint8Array([1]), contentType: "image/webp" });
    await expect(storage.sign(`${studioId}/${assetId}/thumb.webp`, 60)).resolves.toContain("signed");
    await expect(storage.sign(`${studioId}/${assetId}/thumb.webp`, 301)).rejects.toThrow("Gallery storage failed");
  });
});
