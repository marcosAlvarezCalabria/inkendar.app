// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, createStaticHandler, createStaticRouter, isRouteErrorResponse, RouterProvider, StaticRouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
vi.mock("./owner-booking-offers.server.js", () => ({ ownerBookingOfferHandlers: handler }));

import OwnerOffers, { ErrorBoundary, OwnerOffersView, SensitiveAccessLink, headers, loader } from "./routes/owner-offers.js";
import { emptyOwnerOffers, issuedOwnerOfferAccess, ownerOfferFixtureScenarios, populatedOwnerOffers } from "./ui/fixtures/owner-offers.fixtures.js";

const routes = [{ id: "owner-offers", path: "app/owner/offers", loader, Component: OwnerOffers, ErrorBoundary }];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderView(element: React.ReactNode): string {
  const router = createMemoryRouter([{ path: "/app/owner/offers", element }], { initialEntries: ["/app/owner/offers"] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("OWNER offers view", () => {
  it("renders every offer and option state with human UTC dates and a next step", () => {
    const html = renderView(<OwnerOffersView data={populatedOwnerOffers} />);
    for (const label of ["Abierta", "Selección recibida", "Confirmada", "Caducada", "Bloqueada", "Seleccionada", "Liberada"]) expect(html).toContain(label);
    expect(html).toContain("8 oct 2026, 09:00 UTC");
    expect(html).toContain("11 oct 2026, 00:00 UTC");
    expect(html).toContain("Siguiente paso");
    expect(html).toContain("no confirma una cita ni registra señal o pago");
    expect(html.match(/name="intent" value="rotate-access"/gu)).toHaveLength(1);
  });

  it("preserves exact fields and explains configurable expiry and up to three UTC options", () => {
    const html = renderView(<OwnerOffersView data={populatedOwnerOffers} />);
    for (const intent of ["configure-expiry", "create", "expire-due"]) expect(html).toContain(`name="intent" value="${intent}"`);
    for (const field of ["expiryHours", "tattooCaseId", "artistProfileId", "options"]) expect(html).toContain(`name="${field}"`);
    expect(html).toContain("24 horas (1 día)");
    expect(html).toContain("hasta tres opciones preaprobadas");
    expect(html).toContain("UTC");
    expect(html).toContain("Bloquearlas es provisional");
  });

  it("teaches prerequisites and the available action in both empty regions", () => {
    const html = renderView(<OwnerOffersView data={emptyOwnerOffers} />);
    expect(html).toContain("Necesitas un caso abierto y un artista");
    expect(html).toContain('href="/app/owner/cases"');
    expect(html).toContain("Todavía no hay ofertas");
    expect(html).toContain("Cuando cumplas las precondiciones");
  });

  it.each([
    [{ intent: "configure-expiry" } as const, "Guardando plazo…"],
    [{ intent: "create" } as const, "Creando oferta…"],
    [{ intent: "expire-due" } as const, "Liberando vencidas…"],
    [{ intent: "rotate-access", offerId: "offer-open" } as const, "Rotando enlace…"],
  ])("protects only the submitted form for %o", (pending, pendingLabel) => {
    const html = renderView(<OwnerOffersView data={populatedOwnerOffers} pending={pending} />);
    expect(html).toContain(pendingLabel);
    expect(html.match(/aria-busy="true"/gu)).toHaveLength(1);
    expect(html.match(/disabled=""/gu)).toHaveLength(1);
    if (pending.intent !== "create") expect(html).toContain("Crear oferta y bloquear");
    if (pending.intent !== "expire-due") expect(html).toContain("Liberar vencidas");
  });

  it("shows the one-time sensitive result without adding it to offer history", () => {
    const issued = renderView(<OwnerOffersView data={populatedOwnerOffers} actionResult={issuedOwnerOfferAccess} />);
    const ordinary = renderView(<OwnerOffersView data={populatedOwnerOffers} />);
    expect(issued).toContain("Enlace sensible · una sola aparición");
    expect(issued).toContain('readOnly=""');
    expect(headers()["Referrer-Policy"]).toBe("no-referrer");
    expect(issued).toContain(issuedOwnerOfferAccess.accessUrl);
    expect(issued.match(new RegExp(issuedOwnerOfferAccess.accessUrl, "gu"))).toHaveLength(1);
    expect(ordinary).not.toContain(issuedOwnerOfferAccess.accessUrl);
  });

  it("provides reviewable synthetic coverage from 320px through desktop without a production route", () => {
    expect(ownerOfferFixtureScenarios.map(({ id, viewport }) => [id, viewport])).toEqual([
      ["owner-offers-compact", "compact"],
      ["owner-offers-sensitive-link", "mobile"],
      ["owner-offers-empty", "tablet"],
      ["owner-offers-all-states", "desktop"],
    ]);
  });
});

describe("SensitiveAccessLink", () => {
  async function mount() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<SensitiveAccessLink {...issuedOwnerOfferAccess} />));
    return { container, root };
  }

  it("copies with the Clipboard API and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container, root } = await mount();
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(writeText).toHaveBeenCalledWith(issuedOwnerOfferAccess.accessUrl);
    expect(container.textContent).toContain("Enlace copiado");
    root.unmount(); container.remove();
  });

  it("uses the selectable field fallback when Clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    const { container, root } = await mount();
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(container.textContent).toContain("Enlace copiado");
    expect(container.querySelector("input")?.value).toBe(issuedOwnerOfferAccess.accessUrl);
    root.unmount(); container.remove();
  });

  it("keeps the URL selected and explains manual recovery when automatic copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    const { container, root } = await mount();
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    const input = container.querySelector("input") as HTMLInputElement;
    expect(container.textContent).toContain("No se pudo copiar automáticamente");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(issuedOwnerOfferAccess.accessUrl.length);
    root.unmount(); container.remove();
  });
});

describe("owner offers route", () => {
  it("renders a safe offers-specific unavailable state when the loader fails", async () => {
    handler.loader.mockResolvedValueOnce(Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is missing: provider detail" }, { status: 500, headers: { "Cache-Control": "private, no-store" } }));
    const { query, dataRoutes } = createStaticHandler(routes);
    const result = await query(new Request("https://app.inkendar.es/app/owner/offers"));
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("Expected static handler context");
    expect(result.statusCode).toBe(500);
    expect(isRouteErrorResponse(result.errors?.["owner-offers"])).toBe(true);
    expect(result.loaderHeaders["owner-offers"]?.get("Cache-Control")).toBe("private, no-store");
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(html).toContain("Ofertas no disponibles");
    expect(html).toContain("No se pudieron cargar las ofertas. Inténtalo de nuevo más tarde.");
    expect(html).toMatch(/<a\b[^>]*class="button"[^>]*href="\/app\/owner\/offers"[^>]*>Reintentar<\/a>/u);
    expect(html).not.toContain("Todavía no hay ofertas.");
    expect(html).not.toContain("APPLICATION ERROR");
    expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(html).not.toContain("provider detail");
  });
});
