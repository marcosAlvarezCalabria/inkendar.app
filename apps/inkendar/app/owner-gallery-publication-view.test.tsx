import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { OwnerGalleryView } from "./routes/owner-gallery.js";

describe("OwnerGalleryView publication lifecycle", () => {
  it("shows status and only the action allowed for each visible state", () => {
    const statuses = ["DRAFT", "PUBLISHING", "PUBLISHED", "RETIRING"] as const;
    const drafts = statuses.map((status, index) => ({ thumbnailHandle: `90000000-0000-4000-8000-00000000000${index + 1}`, thumbnailSrc: `/thumb/${index}`, status, target: "GALLERY" as const, artistProfileId: null, artistDisplayName: null, altText: `Pieza ${index}`, position: index + 1, width: 480, height: 320 }));
    const router = createMemoryRouter([{ path: "/", element: <OwnerGalleryView data={{ artists: [], drafts, discarded: [] }} /> }]);
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    for (const label of ["Borrador", "Publicando", "Publicada", "Retirando"]) expect(html).toContain(label);
    expect((html.match(/value="PUBLISH"/g) ?? []).length).toBe(2);
    expect((html.match(/value="RETIRE"/g) ?? []).length).toBe(2);
    expect((html.match(/value="UPDATE"/g) ?? []).length).toBe(1);
    expect(html).toContain("Reintentar publicación");
    expect(html).toContain("Reintentar retirada");
    expect(html).not.toMatch(/publicationKey|gallery-public|display\.webp|thumb\.webp/);
  });
});
