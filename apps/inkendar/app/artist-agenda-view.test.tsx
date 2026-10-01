import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn() }));
vi.mock("./artist-agenda.server.js", () => ({ artistAgendaHandlers: handler }));

import ArtistShell, { ArtistAgenda, ErrorBoundary, loader } from "./routes/artist.js";
import { renderUiReviewScenarios } from "./ui/fixtures/ui-review.js";

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
    expect(html).not.toMatch(/href="\/app\/owner(?:\/|")/iu);
    expect(html).not.toMatch(/(?:studioId|userId|appointmentId|customerId|email|phone|conversation|google|token)/iu);
  });
});

describe("artist agenda view", () => {
  it("groups appointments by their local calendar day, including when UTC falls on another day", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[
      {
        ...appointment,
        startUtc: "2026-09-20T00:30:00.000Z",
        endUtc: "2026-09-20T01:30:00.000Z",
        customerDisplayName: "Primera cita sintética",
        timeZone: "America/New_York",
      },
      {
        ...appointment,
        startUtc: "2026-09-20T14:00:00.000Z",
        endUtc: "2026-09-20T15:00:00.000Z",
        customerDisplayName: "Segunda cita sintética",
        timeZone: "America/New_York",
      },
    ]} />);

    expect(html).toContain('<time dateTime="2026-09-19"');
    expect(html).toContain('<time dateTime="2026-09-20"');
    expect(html.indexOf("Primera cita sintética")).toBeLessThan(html.indexOf("Segunda cita sintética"));
  });

  it("preserves loader order and repeats a local-day group when that day is non-contiguous", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[
      { ...appointment, startUtc: "2026-09-21T09:00:00.000Z", endUtc: "2026-09-21T10:00:00.000Z", customerDisplayName: "Cita A" },
      { ...appointment, startUtc: "2026-09-22T09:00:00.000Z", endUtc: "2026-09-22T10:00:00.000Z", customerDisplayName: "Cita B" },
      { ...appointment, startUtc: "2026-09-21T12:00:00.000Z", endUtc: "2026-09-21T13:00:00.000Z", customerDisplayName: "Cita C" },
    ]} />);

    expect(html.indexOf("Cita A")).toBeLessThan(html.indexOf("Cita B"));
    expect(html.indexOf("Cita B")).toBeLessThan(html.indexOf("Cita C"));
    expect(html.match(/dateTime="2026-09-21"/gu)).toHaveLength(2);
  });

  it("marks only the first appointment as the next one with text as well as styling", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[
      appointment,
      { ...appointment, startUtc: "2026-09-21T09:00:00.000Z", endUtc: "2026-09-21T10:00:00.000Z", customerDisplayName: "Otra cita" },
    ]} />);

    expect(html.match(/Próxima cita/gu)).toHaveLength(1);
    expect(html.match(/data-next="true"/gu)).toHaveLength(1);
  });

  it("renders semantic read-only appointments and omits absent optional details without private identifiers", () => {
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
    expect(html).toMatch(/<ol\b[\s\S]*<li\b[\s\S]*<time\b/iu);
    expect(html).not.toMatch(/<form|<input|<button/iu);
    expect(html).not.toMatch(/appointmentId|customerId|conversation|google|token|email|phone/iu);

    const withoutOptionals = renderToStaticMarkup(<ArtistAgenda appointments={[appointment]} />);
    expect(withoutOptionals).not.toContain("Zona del cuerpo");
    expect(withoutOptionals).not.toContain("Tamaño");
  });

  it("renders a private empty state", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[]} />);
    expect(html).toContain("No tienes próximas citas confirmadas");
    expect(html).not.toMatch(/<form|<input/iu);
  });

  it("keeps private synthetic review fixtures for every target viewport and agenda edge case", () => {
    const scenarios = renderUiReviewScenarios({ stylesheetHref: "styles.css", fontStylesheetHref: "archivo.css" })
      .filter(({ id }) => id.startsWith("artist-agenda-"));

    expect(scenarios.map(({ id, width }) => ({ id, width }))).toEqual([
      { id: "artist-agenda-populated-compact", width: 320 },
      { id: "artist-agenda-local-day-mobile", width: 375 },
      { id: "artist-agenda-long-tablet", width: 768 },
      { id: "artist-agenda-empty-desktop", width: 1280 },
    ]);
    const fixtureHtml = scenarios.map(({ html }) => html).join("\n");
    expect(fixtureHtml).toContain("America/New_York");
    expect(fixtureHtml).toContain("No tienes próximas citas confirmadas");
    expect(fixtureHtml).not.toMatch(/(?:@|appointmentId|customerId|conversation|google|token|phone)/iu);
  });
});
