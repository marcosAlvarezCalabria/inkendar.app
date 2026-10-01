import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import type { ArtistOption, Customer, TattooCase } from "@inkendar/application";
import { OwnerCasesView, type OwnerCasesData } from "./routes/owner-cases.js";
import { OwnerCustomersView } from "./routes/owner-customers.js";

const customers = [
  {
    id: "customer-active",
    studioId: "studio-one",
    name: "Noa Cliente Sintética",
    email: "noa@example.invalid",
    phone: "+999000000001",
    status: "ACTIVE",
  },
  {
    id: "customer-archived",
    studioId: "studio-one",
    name: "Iker Cliente Archivado",
    email: null,
    phone: null,
    status: "ARCHIVED",
  },
] satisfies readonly Customer[];

const artists = [
  { id: "artist-one", displayName: "Luz Artista" },
] satisfies readonly ArtistOption[];

const cases = [
  {
    id: "case-open",
    studioId: "studio-one",
    customerId: "customer-active",
    summary: "Serpiente botánica en antebrazo",
    bodyArea: "Antebrazo",
    size: "18 cm",
    artistProfileId: null,
    status: "OPEN",
  },
  {
    id: "case-archived",
    studioId: "studio-one",
    customerId: "customer-archived",
    summary: "Lettering pequeño",
    bodyArea: null,
    size: null,
    artistProfileId: "artist-one",
    status: "ARCHIVED",
  },
] satisfies readonly TattooCase[];

function render(path: string, element: React.ReactNode): string {
  const router = createMemoryRouter([{ path, element }], { initialEntries: [path] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("OWNER customer records view", () => {
  it("separates creation from an editable list and gives every customer identity, textual status and one primary action", () => {
    const html = render("/app/owner/customers", <OwnerCustomersView customers={customers} />);

    expect(html).toContain('id="new-customer"');
    expect(html).toContain('class="record-workspace"');
    expect(html).toContain("Noa Cliente Sintética");
    expect(html).toContain("Activo");
    expect(html).toContain("Iker Cliente Archivado");
    expect(html).toContain("Archivado");
    expect(html).toContain("Archivar conserva el cliente y su historial.");
    expect(html).not.toMatch(/>Borrar</u);
    expect(html.match(/>Guardar cliente</gu)).toHaveLength(2);
  });

  it("protects only the submitted customer form and states its busy intent", () => {
    const html = render("/app/owner/customers", <OwnerCustomersView customers={customers} pending={{ intent: "update", id: "customer-active" }} />);

    expect(html).toMatch(/value="customer-active"[\s\S]*aria-busy="true"[\s\S]*Guardando cliente…/u);
    expect(html).toMatch(/value="customer-archived"[\s\S]*>Guardar cliente</u);
    expect(html.match(/aria-busy="true"/gu)).toHaveLength(1);
  });

  it("teaches the next action in the empty state and preserves alert semantics", () => {
    const html = render("/app/owner/customers", <OwnerCustomersView customers={[]} error="Revisa los datos del cliente." />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Todavía no hay clientes");
    expect(html).toContain('href="#new-customer"');
    expect(html).toContain("Crear el primer cliente");
  });
});

describe("OWNER tattoo case records view", () => {
  const data = { cases, customers, artists } satisfies OwnerCasesData;

  it("shows case identity, customer, assignment and textual OPEN/ARCHIVED states without inventing a pipeline", () => {
    const html = render("/app/owner/cases", <OwnerCasesView data={data} />);

    expect(html).toContain("Serpiente botánica en antebrazo");
    expect(html).toContain("Noa Cliente Sintética");
    expect(html).toContain("Abierto");
    expect(html).toContain("Sin asignar");
    expect(html).toContain("Lettering pequeño");
    expect(html).toContain("Archivado");
    expect(html).toContain("Archivar conserva el caso y su contexto.");
    expect(html).not.toMatch(/(máquina|pigmento|consentimiento|cobro|facturación)/iu);
  });

  it("links to the real customer route when a case cannot yet be created", () => {
    const html = render("/app/owner/cases", <OwnerCasesView data={{ cases: [], customers: [], artists }} />);

    expect(html).toContain("Crea un cliente antes de abrir un caso");
    expect(html).toContain('href="/app/owner/customers"');
    expect(html).toContain("Crear cliente");
  });

  it("protects only the submitted case form and states its busy intent", () => {
    const html = render("/app/owner/cases", <OwnerCasesView data={data} pending={{ intent: "update", id: "case-open" }} />);

    expect(html).toMatch(/value="case-open"[\s\S]*aria-busy="true"[\s\S]*Guardando caso…/u);
    expect(html).toMatch(/value="case-archived"[\s\S]*>Guardar caso</u);
    expect(html.match(/aria-busy="true"/gu)).toHaveLength(1);
  });
});
