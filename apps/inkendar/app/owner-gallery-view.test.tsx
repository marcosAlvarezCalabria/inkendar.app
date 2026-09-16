import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { OwnerGalleryView } from "./routes/owner-gallery.js";

describe("OwnerGalleryView", () => {
  it("renders an accessible multipart form and private draft summary without internal paths", () => {
    const leakedSignedUrl = "http://127.0.0.1:54321/storage/v1/object/sign/gallery-private/20000000-0000-0000-0000-000000000001/60000000-0000-4000-8000-000000000001/thumb.webp?token=signed-secret-token";
    const handle = "90000000-0000-4000-8000-000000000001";
    const html = renderToStaticMarkup(<MemoryRouter><OwnerGalleryView data={{ artists: [{ id: "50000000-0000-0000-0000-000000000001", displayName: "North Artist" }], drafts: [{ thumbnailHandle: handle, thumbnailSrc: `/app/owner/gallery/thumbnails/${handle}`, target: "ARTIST_PORTFOLIO", artistDisplayName: "North Artist", altText: "Pieza floral", position: 1, width: 480, height: 320 }] }} /></MemoryRouter>);
    expect(html).toMatch(/encType="multipart\/form-data"/i);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("Texto alternativo");
    expect(html).toContain("Borradores privados");
    expect(html).toContain("North Artist");
    expect(html).toContain(`/app/owner/gallery/thumbnails/${handle}`);
    for (const secret of ["gallery-private", "thumb.webp", "20000000-0000-0000-0000-000000000001", "60000000-0000-4000-8000-000000000001", new URL(leakedSignedUrl).searchParams.get("token")!]) expect(html).not.toContain(secret);
    expect(html).not.toMatch(/studioId|userId/);
  });
});
