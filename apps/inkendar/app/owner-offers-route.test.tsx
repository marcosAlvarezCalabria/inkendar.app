import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, isRouteErrorResponse, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
vi.mock("./owner-booking-offers.server.js", () => ({ ownerBookingOfferHandlers: handler }));

import OwnerOffers, { ErrorBoundary, loader } from "./routes/owner-offers.js";

const routes = [{
  id: "owner-offers",
  path: "app/owner/offers",
  loader,
  Component: OwnerOffers,
  ErrorBoundary,
}];

describe("owner offers route", () => {
  it("renders a safe offers-specific unavailable state when the loader fails", async () => {
    handler.loader.mockResolvedValueOnce(Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is missing: provider detail" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    ));
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
