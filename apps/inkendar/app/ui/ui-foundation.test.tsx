import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { EmptyState, LoadingState, Notice, StatusBadge, StatusPage } from "./feedback.js";
import { Field, SubmitButton } from "./forms.js";
import { isOwnerNavItemActive, ownerNavItems } from "./owner-nav.js";
import { ArtistShell, OwnerShell, PublicLinkShell } from "./shells.js";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function renderAt(pathname: string, element: ReactNode) {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [pathname] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

function renderOwner(pathname: string) {
  return renderAt(pathname, <OwnerShell title="Clientes"><p>Contenido</p></OwnerShell>);
}

function openingTags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, "giu")) ?? [];
}

describe("OWNER navigation", () => {
  it("lists the seven operational areas in product order", () => {
    expect(ownerNavItems.map((item) => item.label)).toEqual([
      "Panel",
      "Conversaciones",
      "Clientes",
      "Casos",
      "Calendario",
      "Ofertas",
      "Galería",
    ]);
    expect(ownerNavItems.map((item) => item.to)).toEqual([
      "/app/owner",
      "/app/owner/conversations",
      "/app/owner/customers",
      "/app/owner/cases",
      "/app/owner/calendars",
      "/app/owner/offers",
      "/app/owner/gallery",
    ]);
  });

  it("marks the panel active only on its exact path and areas by path segment", () => {
    const [panel, conversations] = ownerNavItems;
    if (!panel || !conversations) throw new Error("Expected navigation items");

    expect(isOwnerNavItemActive(panel, "/app/owner")).toBe(true);
    expect(isOwnerNavItemActive(panel, "/app/owner/")).toBe(true);
    expect(isOwnerNavItemActive(panel, "/app/owner/conversations")).toBe(false);
    expect(isOwnerNavItemActive(conversations, "/app/owner/conversations")).toBe(true);
    expect(isOwnerNavItemActive(conversations, "/app/owner/conversations/")).toBe(true);
    expect(isOwnerNavItemActive(conversations, "/app/owner/conversationsx")).toBe(false);
  });
});

describe("OwnerShell", () => {
  it("exposes the active route with aria-current in every navigation surface", () => {
    const html = renderOwner("/app/owner/customers");
    const current = openingTags(html, "a").filter((tag) => tag.includes('aria-current="page"'));

    expect(current.length).toBeGreaterThan(0);
    for (const tag of current) expect(tag).toContain('href="/app/owner/customers"');
    expect(openingTags(html, "a").filter((tag) => tag.includes('href="/app/owner/cases"') && tag.includes("aria-current"))).toHaveLength(0);
  });

  it("renders unique landmarks, one page title and the logout POST", () => {
    const html = renderOwner("/app/owner/customers");

    expect(openingTags(html, "main")).toHaveLength(1);
    expect(openingTags(html, "h1")).toHaveLength(1);
    expect(html).toMatch(/<h1\b[^>]*>Clientes<\/h1>/u);
    for (const nav of openingTags(html, "nav")) expect(nav).toMatch(/aria-label="[^"]+"/u);
    const forms = openingTags(html, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/method="post"/iu);
    expect(forms[0]).toMatch(/action="\/logout"/iu);
    expect(html).toContain("Cerrar sesión");
  });

  it("opens the mobile menu as a named modal dialog that works before hydration", () => {
    const html = renderOwner("/app/owner");
    const dialog = openingTags(html, "dialog")[0];
    const trigger = openingTags(html, "button").find((tag) => tag.includes('command="show-modal"'));

    expect(dialog).toMatch(/id="([^"]+)"/u);
    expect(dialog).toMatch(/aria-labelledby="[^"]+"/u);
    const dialogId = /id="([^"]+)"/u.exec(dialog ?? "")?.[1];
    expect(trigger).toContain(`commandfor="${dialogId}"`);
    expect(trigger).toMatch(/type="button"/u);
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(/<button\b[^>]*command="close"[^>]*>[^<]*Cerrar menú/u);
  });

  it("keeps logout available in the compact header without JavaScript", () => {
    const html = renderOwner("/app/owner/customers");
    const topbar = /<header\b[^>]*class="[^"]*topbar[^"]*"[^>]*>([\s\S]*?)<\/header>/u.exec(html)?.[1] ?? "";

    expect(topbar).toMatch(/<button\b[^>]*form="session-logout"[^>]*>[^<]*Salir<\/button>/u);
  });

  it("uses a persistent OWNER rail at the tablet breakpoint", () => {
    const styles = readFileSync(join(appDir, "styles.css"), "utf8");
    const appFrameStart = styles.indexOf("/* ---------- App frame");
    const tabletStart = styles.indexOf("@media (min-width: 40rem)", appFrameStart);
    const desktopStart = styles.indexOf("@media (min-width: 64rem)", tabletStart);
    const tabletRules = styles.slice(tabletStart, desktopStart);

    expect(tabletRules).toMatch(/\.app-frame\[data-role="owner"\][\s\S]*grid-template-columns:\s*14rem minmax\(0, 1fr\)/u);
    expect(tabletRules).toMatch(/\.app-frame\[data-role="owner"\] \.topbar,[\s\S]*\.menu-sheet[\s\S]*display:\s*none/u);
    expect(tabletRules).toMatch(/\.rail[\s\S]*display:\s*grid/u);
  });

  it("keeps breadcrumb links at the 44px interaction target", () => {
    const styles = readFileSync(join(appDir, "styles.css"), "utf8");

    expect(styles).toMatch(/\.breadcrumbs a\s*\{[^}]*display:\s*inline-flex[^}]*min-width:\s*44px[^}]*min-height:\s*44px/su);
  });

  it("keeps a short breadcrumb back to the panel inside area pages", () => {
    const html = renderOwner("/app/owner/customers");
    const breadcrumb = /<nav\b[^>]*aria-label="Ruta"[^>]*>([\s\S]*?)<\/nav>/u.exec(html)?.[1] ?? "";

    expect(breadcrumb).toContain('href="/app/owner"');
    expect(breadcrumb).toContain("Clientes");
  });
});

describe("ArtistShell", () => {
  it("offers read-only context without OWNER navigation or mutations", () => {
    const html = renderAt("/app/artist", <ArtistShell displayName="Artista sintético"><p>Agenda</p></ArtistShell>);

    expect(html).toContain("Artista sintético");
    expect(html).toContain("Solo lectura");
    expect(html).not.toContain("/app/owner");
    expect(openingTags(html, "dialog")).toHaveLength(0);
    const forms = openingTags(html, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/action="\/logout"/iu);
    expect(openingTags(html, "main")).toHaveLength(1);
  });
});

describe("PublicLinkShell", () => {
  it("is self-contained: no private navigation, forms or internal vocabulary", () => {
    const html = renderToStaticMarkup(<PublicLinkShell><h1>Huecos disponibles</h1></PublicLinkShell>);

    expect(openingTags(html, "main")).toHaveLength(1);
    expect(html).toContain("Inkendar");
    expect(openingTags(html, "nav")).toHaveLength(0);
    expect(openingTags(html, "form")).toHaveLength(0);
    expect(html).not.toContain("/app");
    expect(html).not.toContain("/login");
    expect(html).not.toMatch(/customer|tattoo|conversation|contact|provider|token|hash|caseId|studioId|calendarId/iu);
  });
});

describe("state patterns", () => {
  it("never communicates a status by color alone", () => {
    for (const tone of ["neutral", "info", "success", "warning", "danger", "pending"] as const) {
      const html = renderToStaticMarkup(<StatusBadge tone={tone}>Estado {tone}</StatusBadge>);
      expect(html).toContain(`Estado ${tone}`);
      expect(html).toMatch(/aria-hidden="true"/u);
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).not.toMatch(/<button|role="button"|href=/u);
    }
  });

  it("announces errors immediately and success or progress politely", () => {
    const error = renderToStaticMarkup(<Notice tone="danger" title="No se pudo guardar">Revisa el email.</Notice>);
    const success = renderToStaticMarkup(<Notice tone="success" title="Cliente guardado" />);
    const pending = renderToStaticMarkup(<Notice tone="pending" title="Guardando" />);

    expect(error).toContain('role="alert"');
    expect(error).toContain("No se pudo guardar");
    expect(error).toContain("Revisa el email.");
    expect(success).toContain('role="status"');
    expect(success).not.toContain('role="alert"');
    expect(pending).toContain('role="status"');
    for (const html of [error, success, pending]) expect(html).toMatch(/data-tone="[a-z]+"/u);
  });

  it("offers an action in an empty state only when one is provided", () => {
    const withAction = renderToStaticMarkup(<EmptyState title="Todavía no hay clientes" action={<a href="#nuevo">Crear cliente</a>}>Los clientes permiten vincular conversaciones y casos.</EmptyState>);
    const readOnly = renderToStaticMarkup(<EmptyState title="No tienes próximas citas confirmadas" />);

    expect(withAction).toContain("Todavía no hay clientes");
    expect(withAction).toContain("Crear cliente");
    expect(readOnly).not.toMatch(/<a\b|<button\b/u);
  });

  it("names the section being loaded and marks the region busy", () => {
    const html = renderToStaticMarkup(<LoadingState label="Cargando conversaciones" />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Cargando conversaciones");
    expect(html).not.toMatch(/role="alert"/u);
  });

  it("renders a denied page that does not reveal whether data exists", () => {
    const html = renderToStaticMarkup(<StatusPage tone="danger" title="Acceso denegado">Tu cuenta no tiene acceso a esta área.</StatusPage>);

    expect(openingTags(html, "main")).toHaveLength(1);
    expect(html).toMatch(/<h1\b[^>]*>Acceso denegado<\/h1>/u);
    expect(html).not.toMatch(/<form|role="button"/u);
  });
});

describe("form patterns", () => {
  it("associates label, hint and error with the control", () => {
    const html = renderToStaticMarkup(
      <Field label="Email" hint="Solo para avisos del estudio." error="Escribe un email válido, por ejemplo nombre@dominio.es.">
        {(control) => <input name="email" type="email" {...control} />}
      </Field>,
    );
    const input = openingTags(html, "input")[0] ?? "";
    const id = /id="([^"]+)"/u.exec(input)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/u.exec(input)?.[1]?.split(" ") ?? [];

    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('name="email"');
    expect(describedBy).toHaveLength(2);
    for (const describer of describedBy) expect(html).toContain(`id="${describer}"`);
    expect(html).toContain("Escribe un email válido");
  });

  it("omits invalid state when the field has no error", () => {
    const html = renderToStaticMarkup(<Field label="Nombre">{(control) => <input name="name" {...control} />}</Field>);

    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("keeps a busy submit button named by its intent and blocks double submission", () => {
    const idle = renderToStaticMarkup(<SubmitButton pendingLabel="Guardando cliente…">Guardar cliente</SubmitButton>);
    const busy = renderToStaticMarkup(<SubmitButton pending pendingLabel="Guardando cliente…" name="intent" value="create">Guardar cliente</SubmitButton>);

    expect(idle).toMatch(/type="submit"/u);
    expect(idle).not.toMatch(/disabled|aria-busy/u);
    expect(busy).toContain("Guardando cliente…");
    expect(busy).toMatch(/disabled=""/u);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('name="intent"');
    expect(busy).toContain('value="create"');
  });
});

describe("presentation fixtures", () => {
  it("never reach production routes or the root document", () => {
    const productionFiles = [join(appDir, "root.tsx"), join(appDir, "routes.ts"), ...readdirSync(join(appDir, "routes")).map((file) => join(appDir, "routes", file))];

    for (const file of productionFiles) expect(readFileSync(file, "utf8"), file).not.toMatch(/fixtures?/iu);
  });

  it("use only synthetic, non-deliverable contact data", async () => {
    const { uiFoundationScenarios } = await import("./fixtures/ui-foundation.fixtures.js");
    const serialized = JSON.stringify(uiFoundationScenarios);

    expect(uiFoundationScenarios.length).toBeGreaterThan(0);
    for (const email of serialized.match(/[\w.+-]+@[\w.-]+/gu) ?? []) expect(email).toMatch(/@example\.invalid$/u);
    for (const scenario of uiFoundationScenarios) expect(["mobile", "tablet", "desktop"]).toContain(scenario.viewport);
  });

  it("render every scenario in the review document with the shared stylesheet", async () => {
    const { uiFoundationScenarios } = await import("./fixtures/ui-foundation.fixtures.js");
    const { renderUiReviewDocument } = await import("./fixtures/ui-review.js");
    const html = renderUiReviewDocument({ stylesheetHref: "styles.css", fontStylesheetHref: "font.css" });

    expect(html).toMatch(/^<!doctype html>/iu);
    expect(html).toContain('<html lang="es"');
    expect(html).toContain('href="styles.css"');
    for (const scenario of uiFoundationScenarios) expect(html).toContain(`id="${scenario.id}"`);
    expect(html).toContain("Entorno de desarrollo");
  });
});
