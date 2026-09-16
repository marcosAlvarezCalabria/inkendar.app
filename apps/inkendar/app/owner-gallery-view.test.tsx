import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { OwnerGalleryView } from "./routes/owner-gallery.js";

describe("OwnerGalleryView", () => {
  it("renders an accessible multipart form and private draft summary without internal paths", () => {
    const html = renderToStaticMarkup(<MemoryRouter><OwnerGalleryView data={{ artists: [{ id: "50000000-0000-0000-0000-000000000001", displayName: "North Artist" }], drafts: [{ publicId: "public-safe", target: "ARTIST_PORTFOLIO", artistDisplayName: "North Artist", altText: "Pieza floral", position: 1, width: 480, height: 320, thumbnailUrl: "https://storage.example/signed" }] }} /></MemoryRouter>);
    expect(html).toMatch(/encType="multipart\/form-data"/i);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("Texto alternativo");
    expect(html).toContain("Borradores privados");
    expect(html).toContain("North Artist");
    expect(html).not.toMatch(/gallery-private|thumb\.webp|studioId|userId/);
  });
});
