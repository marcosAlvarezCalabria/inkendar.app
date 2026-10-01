// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ownerGalleryFixtureScenarios, populatedOwnerGallery } from "./ui/fixtures/owner-gallery.fixtures.js";
import { OwnerGalleryView, type OwnerGalleryPending } from "./routes/owner-gallery.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function render(pending?: OwnerGalleryPending, error?: string): string {
  const router = createMemoryRouter([{
    path: "/app/owner/gallery",
    element: <OwnerGalleryView data={populatedOwnerGallery} {...(pending ? { pending } : {})} {...(error ? { error } : {})} />,
  }], { initialEntries: ["/app/owner/gallery"] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("OwnerGalleryView", () => {
  it("explains safe ingestion and preserves the exact mutation contract", () => {
    const html = render();

    expect(html).toMatch(/encType="multipart\/form-data"/i);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("JPEG, PNG o WebP");
    expect(html).toContain("10 MiB");
    expect(html).toContain("12000 × 12000");
    expect(html).toContain("40 megapíxeles");
    expect(html).toMatch(/elimina metadata/i);
    for (const intent of ["CREATE_DRAFT", "UPDATE", "MOVE_UP", "MOVE_DOWN", "DISCARD", "PUBLISH", "RETIRE", "RESTORE"]) {
      expect(html).toContain(`value="${intent}"`);
    }
    expect(html).not.toMatch(/value="(?:UPDATE_DRAFT|DISCARD_DRAFT)"/u);
    expect(html).not.toMatch(/studioId|userId|assetId|objectPath|name="path"|name="status"/u);
  });

  it("renders contained 4:3 thumbnails, editorial metadata, textual lifecycle guidance and named controls", () => {
    const html = render();

    expect(html.match(/class="gallery-thumbnail"/gu)).toHaveLength(4);
    expect(html).toContain('alt="Boceto vertical de una peonía con hojas largas sobre fondo claro"');
    expect(html).toContain("Galería general");
    expect(html).toContain("Portfolio de Luz Artista");
    expect(html).toMatch(/<dt>Posición<\/dt><dd>1<\/dd>/u);
    for (const state of ["Borrador", "Publicación en curso", "Publicada", "Retirada en curso", "Descartado"]) expect(html).toContain(state);
    expect(html.match(/Cerrar esta pantalla no cancela el proceso/gu)).toHaveLength(2);
    expect(html).toContain("El reintento conserva la misma publicación");
    expect(html).toContain("El reintento continúa la misma retirada");
    expect(html).toContain("Descartar aparta un borrador privado");
    expect(html).toContain("Retirar quita de la web una imagen publicada");

    const namedActions = [
      "Guardar cambios de Boceto vertical de una peonía con hojas largas sobre fondo claro",
      "Subir Boceto vertical de una peonía con hojas largas sobre fondo claro",
      "Bajar Boceto vertical de una peonía con hojas largas sobre fondo claro",
      "Descartar borrador Boceto vertical de una peonía con hojas largas sobre fondo claro",
      "Publicar Boceto vertical de una peonía con hojas largas sobre fondo claro",
      "Reintentar publicación Composición horizontal de olas y luna",
      "Retirar Retrato botánico publicado",
      "Reintentar retirada Ornamento geométrico en retirada",
      "Restaurar Pieza descartada recuperable",
    ];
    for (const name of namedActions) expect(html).toContain(`aria-label="${name}"`);
  });

  it("requires an artist only for portfolio targets in the rendered state", () => {
    const html = render();

    expect(html).toMatch(/name="artistProfileId"[^>]*required/u);
    expect(html).toMatch(/name="artistProfileId"[^>]*disabled/u);
  });

  it("updates the artist requirement when the upload destination changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const router = createMemoryRouter([{ path: "/", element: <OwnerGalleryView data={populatedOwnerGallery} /> }]);
    await act(async () => root.render(<RouterProvider router={router} />));
    const upload = container.querySelector("#gallery-upload") as HTMLElement;
    const target = upload.querySelector('select[name="target"]') as HTMLSelectElement;
    const artist = upload.querySelector('select[name="artistProfileId"]') as HTMLSelectElement;

    expect(artist.disabled).toBe(true);
    expect(artist.required).toBe(false);
    await act(async () => {
      target.value = "ARTIST_PORTFOLIO";
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(artist.disabled).toBe(false);
    expect(artist.required).toBe(true);
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    [{ intent: "CREATE_DRAFT" } as const, "Guardando borrador…"],
    [{ intent: "UPDATE", handle: "90000000-0000-4000-8000-000000000001" } as const, "Guardando cambios…"],
    [{ intent: "MOVE_UP", handle: "90000000-0000-4000-8000-000000000001" } as const, "Moviendo arriba…"],
    [{ intent: "DISCARD", handle: "90000000-0000-4000-8000-000000000001" } as const, "Descartando…"],
    [{ intent: "PUBLISH", handle: "90000000-0000-4000-8000-000000000002" } as const, "Reintentando publicación…"],
    [{ intent: "RETIRE", handle: "90000000-0000-4000-8000-000000000003" } as const, "Retirando publicación…"],
    [{ intent: "RESTORE", handle: "90000000-0000-4000-8000-000000000099" } as const, "Restaurando borrador…"],
  ])("blocks only the submitted intention for %o and names its pending work", (pending, label) => {
    const html = render(pending);

    expect(html).toContain(label);
    expect(html.match(/aria-busy="true"/gu)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/u);
    if (pending.intent === "CREATE_DRAFT") expect(html).toContain("Guardar cambios");
    else expect(html).toContain("Guardar borrador privado");
    if (pending.intent === "UPDATE") expect(html).toContain('value="Boceto vertical de una peonía con hojas largas sobre fondo claro"');
  });

  it("teaches useful empty states and exposes action errors as alerts", () => {
    const empty = ownerGalleryFixtureScenarios.find((scenario) => scenario.id === "owner-gallery-empty");
    expect(empty).toBeDefined();
    const router = createMemoryRouter([{ path: "/", element: <OwnerGalleryView data={empty!.view.data} error="No se pudo guardar la imagen. Revisa los datos y vuelve a intentarlo." /> }]);
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Aún no hay imágenes activas");
    expect(html).toContain('href="#gallery-upload"');
    expect(html).toContain("Subir la primera imagen");
    expect(html).toContain("No hay borradores descartados");
  });

  it("keeps fixtures synthetic, typed and outside provider URLs", () => {
    expect(ownerGalleryFixtureScenarios.map(({ id }) => id)).toEqual([
      "owner-gallery-mobile",
      "owner-gallery-all-states",
      "owner-gallery-empty",
      "owner-gallery-error",
    ]);
    const fixtureText = JSON.stringify(ownerGalleryFixtureScenarios);
    expect(fixtureText).not.toMatch(/https?:\/\//u);
    expect(fixtureText).not.toMatch(/supabase|cloudflare|storage\/v1|token=/iu);
  });
});
