import { describe, expect, it, vi } from "vitest";
import { SupabaseGalleryPublicationRepository } from "./supabase-gallery-publication.js";

const handle = "90000000-0000-4000-8000-000000000001";
const publicationKey = "70000000-0000-4000-8000-000000000001";
const privateDisplay = "20000000-0000-4000-8000-000000000001/60000000-0000-4000-8000-000000000001/display.webp";
const privateThumb = "20000000-0000-4000-8000-000000000001/60000000-0000-4000-8000-000000000001/thumb.webp";

describe("Supabase gallery publication repository", () => {
  it("maps a server-only publish binding and sends only handle/key to auth-bound RPCs", async () => {
    const gateway = gatewayWith({ beginPublish: vi.fn().mockResolvedValue({ data: [{ outcome: "WORK", publication_key: publicationKey, private_display_path: privateDisplay, private_display_mime_type: "image/webp", private_display_byte_size: 3, private_thumb_path: privateThumb, private_thumb_mime_type: "image/webp", private_thumb_byte_size: 2, public_display_path: `${publicationKey}/display.webp`, public_thumb_path: `${publicationKey}/thumb.webp` }], error: null }) });
    const repository = new SupabaseGalleryPublicationRepository(gateway);
    await expect(repository.beginPublish(handle)).resolves.toEqual({ outcome: "WORK", publicationKey, variants: [
      { kind: "DISPLAY", privatePath: privateDisplay, publicPath: `${publicationKey}/display.webp`, mimeType: "image/webp", byteSize: 3 },
      { kind: "THUMB", privatePath: privateThumb, publicPath: `${publicationKey}/thumb.webp`, mimeType: "image/webp", byteSize: 2 },
    ] });
    await repository.finalizePublish(handle, publicationKey);
    expect(gateway.beginPublish).toHaveBeenCalledWith({ p_handle: handle });
    expect(gateway.finalizePublish).toHaveBeenCalledWith({ p_handle: handle, p_publication_key: publicationKey });
    expect(JSON.stringify(gateway.beginPublish.mock.calls)).not.toMatch(/studio|user|asset|path|status/i);
  });

  it("maps retirement work and completed retries without leaking a binding", async () => {
    const gateway = gatewayWith({
      beginRetire: vi.fn().mockResolvedValue({ data: [{ outcome: "WORK", publication_key: publicationKey, public_display_path: `${publicationKey}/display.webp`, public_thumb_path: `${publicationKey}/thumb.webp` }], error: null }),
      beginPublish: vi.fn().mockResolvedValue({ data: [{ outcome: "COMPLETE", publication_key: null, private_display_path: null, private_display_mime_type: null, private_display_byte_size: null, private_thumb_path: null, private_thumb_mime_type: null, private_thumb_byte_size: null, public_display_path: null, public_thumb_path: null }], error: null }),
    });
    const repository = new SupabaseGalleryPublicationRepository(gateway);
    await expect(repository.beginRetire(handle)).resolves.toEqual({ outcome: "WORK", publicationKey, publicPaths: [`${publicationKey}/display.webp`, `${publicationKey}/thumb.webp`] });
    await expect(repository.beginPublish(handle)).resolves.toEqual({ outcome: "COMPLETE" });
  });

  it("fails closed on malformed rows or provider errors", async () => {
    const gateway = gatewayWith({ beginPublish: vi.fn().mockResolvedValue({ data: [{ outcome: "WORK", publication_key: publicationKey, private_display_path: `${privateDisplay}/../master.webp` }], error: null }) });
    await expect(new SupabaseGalleryPublicationRepository(gateway).beginPublish(handle)).rejects.toThrow("Gallery publication persistence failed");
  });
});

function gatewayWith(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return { beginPublish: vi.fn(), finalizePublish: vi.fn().mockResolvedValue({ data: null, error: null }), beginRetire: vi.fn(), finalizeRetire: vi.fn().mockResolvedValue({ data: null, error: null }), ...overrides };
}
