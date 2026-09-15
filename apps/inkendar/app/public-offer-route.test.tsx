import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn() }));
vi.mock("./public-booking-offer.server.js", () => ({
  publicBookingOfferHandlers: handler,
  publicBookingOfferHeaders: () => new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }),
}));

import PublicOffer, { ErrorBoundary, loader } from "./routes/public-offer.js";

const routes = [{ id: "public-offer", path: "offers/:token", loader: loader as never, Component: PublicOffer, ErrorBoundary }];

describe("public booking offer route", () => {
  it("renders provisional options without leaking private fields or claiming confirmation", async () => {
    handler.loader.mockResolvedValueOnce(Response.json({
      expiresAt: "2026-09-16T10:00:00.000Z",
      artistDisplayName: "Ana",
      timeZone: "Europe/Dublin",
      options: [{ startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" }],
    }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }));
    const { query, dataRoutes } = createStaticHandler(routes);

    const result = await query(new Request(`https://app.inkendar.es/offers/${"A".repeat(43)}`));

    if (result instanceof Response) throw new Error("Expected static handler context");
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(html).toContain("Opciones reservadas provisionalmente");
    expect(html).toContain("Ana");
    expect(html).toContain("Europe/Dublin");
    expect(html).toContain("2026-09-20T09:00:00.000Z");
    expect(html).toContain("Todavía no son una cita confirmada");
    expect(html).not.toMatch(/customer|tattoo|conversation|contact|provider|token|hash/iu);
  });

  it("renders one generic unavailable state without reflecting the token or provider errors", async () => {
    handler.loader.mockResolvedValueOnce(new Response("provider detail", { status: 404, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }));
    const { query, dataRoutes } = createStaticHandler(routes);
    const token = "B".repeat(43);

    const result = await query(new Request(`https://app.inkendar.es/offers/${token}`));

    if (result instanceof Response) throw new Error("Expected static handler context");
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(result.statusCode).toBe(404);
    expect(html).toContain("Esta oferta no está disponible");
    expect(html).not.toContain(token);
    expect(html).not.toContain("provider detail");
  });
});
