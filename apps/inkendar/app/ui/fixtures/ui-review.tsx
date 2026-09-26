/**
 * Static review harness for the visual foundation. Development only: rendered by
 * `pnpm run ui:review`, never imported by routes, loaders, actions or the root document.
 */
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { EmptyState, LoadingState, Notice, StatusBadge, StatusPage } from "../feedback.js";
import { Field, SubmitButton } from "../forms.js";
import { ArtistShell, OwnerShell, PublicLinkShell } from "../shells.js";
import type { UiFoundationView } from "./ui-foundation.fixtures.js";
import { uiFoundationScenarios } from "./ui-foundation.fixtures.js";

export const viewportWidths = { compact: 320, mobile: 375, tablet: 768, desktop: 1280 } as const;

type ReviewAssets = Readonly<{ stylesheetHref: string; fontStylesheetHref: string }>;

function reviewHead({ stylesheetHref, fontStylesheetHref }: ReviewAssets): string {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="${fontStylesheetHref}"><link rel="stylesheet" href="${stylesheetHref}">`;
}

/** One standalone document per scenario, for per-viewport screenshots. */
export function renderUiReviewScenarios(assets: ReviewAssets) {
  return uiFoundationScenarios.map((scenario) => ({
    id: scenario.id,
    width: viewportWidths[scenario.viewport],
    html: `<!doctype html><html lang="es"><head>${reviewHead(assets)}<title>${scenario.id} | Inkendar</title></head><body>${renderToStaticMarkup(renderView(scenario.view))}</body></html>`,
  }));
}

export function renderUiReviewDocument(assets: ReviewAssets): string {
  const head = reviewHead(assets);
  const frames = renderUiReviewScenarios(assets).map(({ id, width, html: inner }) => {
    const scenario = uiFoundationScenarios.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown scenario ${id}`);
    return `<section class="review-case" id="${scenario.id}"><h2>${scenario.description}</h2><p>${scenario.viewport} · ${width}px · <code>${scenario.id}</code></p><iframe title="${scenario.description}" width="${width}" height="${scenario.viewport === "desktop" ? 720 : 760}" srcdoc="${escapeAttribute(inner)}"></iframe></section>`;
  });

  return `<!doctype html><html lang="es"><head>${head}<title>Fundación visual | Inkendar</title><style>
    .review { display: grid; gap: 48px; padding: 24px; }
    .review-case { display: grid; gap: 8px; justify-items: start; }
    .review-case h2 { margin: 0; font-size: 1.25rem; }
    .review-case p { margin: 0; color: var(--text-muted); }
    .review-case iframe { max-width: 100%; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--ink); }
  </style></head><body><div class="review"><div class="notice" data-tone="warning" role="status"><span class="notice-glyph" aria-hidden="true">!</span><div class="notice-body"><p class="notice-title">Entorno de desarrollo · datos sintéticos</p><div class="notice-text">Escenarios de presentación sin backend. No es una ruta de la aplicación.</div></div></div>${frames.join("")}</div></body></html>`;
}

function renderView(view: UiFoundationView): ReactElement {
  switch (view.kind) {
    case "owner-shell":
      return (
        <At pathname={view.pathname}>
          <OwnerShell title={view.title} description={"description" in view ? view.description : undefined} action={<a className="button button-primary" href="#nuevo">Nuevo cliente</a>}>
            <SampleWorkArea />
          </OwnerShell>
        </At>
      );
    case "artist-shell":
      return (
        <At pathname="/app/artist">
          <ArtistShell displayName={view.displayName}>
            <section className="shell-panel" aria-labelledby="sample-agenda">
              <h2 id="sample-agenda">Próximas citas</h2>
              <EmptyState title="No tienes próximas citas confirmadas">Cuando el estudio confirme una cita contigo aparecerá aquí.</EmptyState>
            </section>
          </ArtistShell>
        </At>
      );
    case "public-shell":
      return (
        <PublicLinkShell>
          <StatusBadge tone="pending">Pendiente de aprobación</StatusBadge>
          <h1>{view.title}</h1>
          <p>{view.body}</p>
          <p className="meta-line">Zona horaria: Europe/Madrid</p>
        </PublicLinkShell>
      );
    case "badges":
      return <div className="review-surface"><div className="stamp-row">{view.items.map((item) => <StatusBadge key={item.tone} tone={item.tone}>{item.label}</StatusBadge>)}</div></div>;
    case "notices":
      return <div className="review-surface stack">{view.items.map((item) => <Notice key={item.title} tone={item.tone} title={item.title}>{item.text}</Notice>)}</div>;
    case "states":
      return (
        <div className="review-surface stack">
          <section className="shell-panel"><h2>Conversaciones</h2><LoadingState label="Cargando conversaciones" /></section>
          <section className="shell-panel"><h2>Clientes del estudio</h2><EmptyState title="Todavía no hay clientes" action={<a className="button button-primary" href="#nuevo">Crear cliente</a>}>Los clientes permiten vincular conversaciones y casos.</EmptyState></section>
          <section className="shell-panel"><h2>Bandeja del estudio</h2><Notice tone="warning" title="Bandeja temporalmente no disponible">No podemos cargar las conversaciones ahora. Esto no significa que la bandeja esté vacía.</Notice></section>
        </div>
      );
    case "form":
      return (
        <div className="review-surface">
          <section className="shell-panel">
            <h2>Nuevo cliente</h2>
            <form className="record-form" method="post" action="#">
              <Field label="Nombre">{(control) => <input name="name" defaultValue="Noa Cliente Sintética" {...control} />}</Field>
              <Field label="Email" hint="Solo para avisos del estudio." {...("error" in view && view.error ? { error: view.error } : {})}>{(control) => <input name="email" type="email" defaultValue="noa@example" {...control} />}</Field>
              <SubmitButton className="button button-primary" pending={view.pending} pendingLabel="Guardando cliente…">Crear cliente</SubmitButton>
            </form>
          </section>
        </div>
      );
    case "status-page":
      return <StatusPage tone={view.tone} title={view.title}>{view.text}</StatusPage>;
  }
}

function At({ pathname, children }: Readonly<{ pathname: string; children: ReactNode }>) {
  return <RouterProvider router={createMemoryRouter([{ path: "*", element: children }], { initialEntries: [pathname] })} />;
}

function SampleWorkArea() {
  return (
    <>
      <Notice tone="success" title="Cliente guardado" />
      <section className="shell-panel" aria-labelledby="sample-create">
        <h2 id="sample-create">Nuevo cliente</h2>
        <form className="record-form" method="post" action="#">
          <label>Nombre <input name="name" autoComplete="off" /></label>
          <label>Email <input name="email" type="email" placeholder="nombre@example.invalid" /></label>
          <label>Teléfono internacional <input name="phone" type="tel" placeholder="+34600000000" /></label>
          <button type="submit">Crear cliente</button>
        </form>
      </section>
      <section className="records" aria-labelledby="sample-list">
        <h2 id="sample-list">Clientes del estudio</h2>
        <article className="shell-panel">
          <div className="record-head"><h3>Noa Cliente Sintética</h3><StatusBadge tone="success">Activo</StatusBadge></div>
          <p className="meta-line">noa@example.invalid · +34 600 000 000</p>
        </article>
        <article className="shell-panel" data-archived="">
          <div className="record-head"><h3>Iker Cliente Archivado</h3><StatusBadge tone="neutral">Archivado</StatusBadge></div>
          <p className="meta-line">Sin email · Sin teléfono</p>
        </article>
      </section>
    </>
  );
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
