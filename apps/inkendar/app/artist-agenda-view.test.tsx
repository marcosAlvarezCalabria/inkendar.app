import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn() }));
vi.mock("./artist-agenda.server.js", () => ({ artistAgendaHandlers: handler }));

import ArtistShell, { ArtistAgenda, ErrorBoundary, loader } from "./routes/artist.js";

const routes = [{
  id: "artist",
  path: "app/artist",
  loader,
  Component: ArtistShell,
  ErrorBoundary,
}];

const appointment = {
  startUtc: "2026-09-20T09:00:00.000Z",
  endUtc: "2026-09-20T10:00:00.000Z",
  customerDisplayName: "Cliente sintético",
  caseSummary: "Pieza floral",
  bodyArea: null,
  size: null,
  timeZone: "UTC",
} as const;

describe("artist agenda route shell", () => {
  it("allows only the global logout POST and exposes no agenda mutation controls", async () => {
    handler.loader.mockResolvedValueOnce(Response.json({ displayName: "Artista", appointments: [appointment] }));
    const { query, dataRoutes } = createStaticHandler(routes);
    const result = await query(new Request("https://app.inkendar.es/app/artist"));

    if (result instanceof Response) throw new Error("Expected static handler context");
    expect(result.statusCode).toBe(200);
    expect(result.errors).toBeNull();
    const html = renderToStaticMarkup(
      <StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />,
    );

    const forms = html.match(/<form\b[^>]*>/giu) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/\baction="\/logout"/iu);
    expect(forms[0]).toMatch(/\bmethod="post"/iu);
    expect(html).toContain("Cerrar sesión");
    expect(html).not.toMatch(/<(?:input|select|textarea)\b/iu);
    expect(Array.from(html.matchAll(/action="([^"]+)"/giu), (match) => match[1])).toEqual(["/logout"]);
    expect(html).not.toMatch(/(?:editar|cancelar|confirmar|responder|guardar cita)/iu);
  });
});

describe("artist agenda view", () => {
  it("renders an accessible read-only appointment without private identifiers", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[{
      ...appointment,
      bodyArea: "Brazo",
      size: "Mediana",
      timeZone: "Europe/Dublin",
    }]} />);

    expect(html).toContain("Próximas citas");
    expect(html).toContain("Cliente sintético");
    expect(html).toContain("Pieza floral");
    expect(html).toContain("Brazo");
    expect(html).toContain("Mediana");
    expect(html).toContain("Europe/Dublin");
    expect(html).toContain('dateTime="2026-09-20T09:00:00.000Z"');
    expect(html).not.toMatch(/<form|<input|<button/iu);
    expect(html).not.toMatch(/appointmentId|customerId|conversation|google|token|email|phone/iu);
  });

  it("renders a private empty state", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[]} />);
    expect(html).toContain("No tienes próximas citas confirmadas");
    expect(html).not.toMatch(/<form|<input/iu);
  });
});
