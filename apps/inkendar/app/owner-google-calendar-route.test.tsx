import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, isRouteErrorResponse, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
vi.mock("./owner-google-calendar.server.js", () => ({ ownerGoogleCalendarHandlers: handler }));

import OwnerCalendars, { ErrorBoundary, loader } from "./routes/owner-calendars.js";

const routes = [{
  id: "owner-calendars",
  path: "app/owner/calendars",
  loader,
  Component: OwnerCalendars,
  ErrorBoundary,
}];

describe("owner Google Calendar route", () => {
  it("routes a transient 503 to a safe boundary instead of treating it as calendar data", async () => {
    handler.loader.mockResolvedValueOnce(Response.json(
      { error: "Google Calendar no está disponible temporalmente." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    ));
    const { query, dataRoutes } = createStaticHandler(routes);

    const result = await query(new Request("https://app.inkendar.es/app/owner/calendars"));

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("Expected static handler context");
    expect(result.statusCode).toBe(503);
    expect(isRouteErrorResponse(result.errors?.["owner-calendars"])).toBe(true);
    expect(result.loaderHeaders["owner-calendars"]?.get("Cache-Control")).toBe("private, no-store");
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(html).toContain("Google Calendar no disponible");
    expect(html).toContain("Inténtalo de nuevo más tarde.");
    expect(html).not.toContain("provider detail");
    expect(html).not.toContain("TypeError");
  });

  it("continues rendering a successful management view", async () => {
    handler.loader.mockResolvedValueOnce(Response.json({ connectionStatus: "NOT_CONNECTED", calendars: [], artists: [] }, { headers: { "Cache-Control": "private, no-store" } }));
    const { query, dataRoutes } = createStaticHandler(routes);

    const result = await query(new Request("https://app.inkendar.es/app/owner/calendars"));

    if (result instanceof Response) throw new Error("Expected static handler context");
    expect(result.statusCode).toBe(200);
    expect(result.errors).toBeNull();
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(html).toContain("Google Calendar no está conectado");
  });
});
