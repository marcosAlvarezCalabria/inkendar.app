import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import type { LoaderFunction } from "react-router";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
const conversations = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const records = vi.hoisted(() => ({
  customersLoader: vi.fn(),
  customerAction: vi.fn(),
  casesLoader: vi.fn(),
  caseAction: vi.fn(),
}));
const calendar = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const availability = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const freeChoice = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const offers = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const gallery = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const team = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));

vi.mock("./auth.server.js", () => ({ authHandlers: auth }));
vi.mock("./owner-conversations.server.js", () => ({ ownerConversationsHandlers: conversations }));
vi.mock("./owner-customer-cases.server.js", () => ({ ownerCustomerCasesHandlers: records }));
vi.mock("./owner-google-calendar.server.js", () => ({ ownerGoogleCalendarHandlers: calendar }));
vi.mock("./owner-availability.server.js", () => ({ ownerAvailabilityHandlers: availability }));
vi.mock("./free-choice-availability.server.js", () => ({ ownerFreeChoiceAvailabilityHandlers: freeChoice }));
vi.mock("./free-choice-owner-decision.server.js", () => ({ ownerFreeChoiceDecisionHandlers: { action: vi.fn() } }));
vi.mock("./owner-booking-offers.server.js", () => ({ ownerBookingOfferHandlers: offers }));
vi.mock("./owner-gallery.server.js", () => ({ ownerGalleryHandlers: gallery }));
vi.mock("./owner-access.server.js", () => ({ ownerAccessHandlers: team }));

import * as ownerRoute from "./routes/owner.js";
import * as conversationsRoute from "./routes/owner-conversations.js";
import * as customersRoute from "./routes/owner-customers.js";
import * as casesRoute from "./routes/owner-cases.js";
import * as calendarsRoute from "./routes/owner-calendars.js";
import * as offersRoute from "./routes/owner-offers.js";
import * as galleryRoute from "./routes/owner-gallery.js";
import * as teamRoute from "./routes/owner-team.js";

type RouteModule = Readonly<{
  default: () => React.JSX.Element;
  loader: LoaderFunction;
  ErrorBoundary?: () => React.JSX.Element;
}>;

const cases = [
  { id: "owner", path: "app/owner", route: ownerRoute, fail: () => auth.requireRole.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "conversations", path: "app/owner/conversations", route: conversationsRoute, fail: () => conversations.loader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "customers", path: "app/owner/customers", route: customersRoute, fail: () => records.customersLoader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "tattoo-cases", path: "app/owner/cases", route: casesRoute, fail: () => records.casesLoader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "calendars", path: "app/owner/calendars", route: calendarsRoute, fail: () => calendar.loader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "offers", path: "app/owner/offers", route: offersRoute, fail: () => offers.loader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "gallery", path: "app/owner/gallery", route: galleryRoute, fail: () => gallery.loader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
  { id: "team", path: "app/owner/team", route: teamRoute, fail: () => team.loader.mockResolvedValueOnce(new Response(null, { status: 403 })) },
] as const;

describe("OWNER permission boundaries", () => {
  it.each(cases)("renders a data-free denied state for $path", async ({ id, path, route, fail }) => {
    fail();
    const boundary = (route as RouteModule).ErrorBoundary;
    expect(boundary).toBeTypeOf("function");
    if (!boundary) throw new Error(`Missing ErrorBoundary for ${path}`);
    const { query, dataRoutes } = createStaticHandler([{
      id,
      path,
      loader: (route as RouteModule).loader,
      Component: (route as RouteModule).default,
      ErrorBoundary: boundary,
    }]);

    const result = await query(new Request(`https://app.inkendar.es/${path}`));
    if (result instanceof Response) throw new Error("Expected static handler context");
    const html = renderToStaticMarkup(
      <StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />,
    );

    expect(result.statusCode).toBe(403);
    expect(html).toMatch(/<h1\b[^>]*>Acceso denegado<\/h1>/u);
    expect(html).toContain("Tu cuenta no tiene acceso a esta área.");
    expect(html).not.toMatch(/owner-nav|Cambiar (?:cuenta|rol)|href="\/app\/owner|href="\/login/iu);
    expect(html).not.toMatch(/Cliente sintético|Caso sintético|Artista sintético|conversaci[oó]n de prueba/iu);
  });

  it("renders a safe gallery-specific state for a 500 without consuming failure JSON", async () => {
    gallery.loader.mockResolvedValueOnce(Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is missing: provider detail" },
      { status: 500 },
    ));
    const boundary = (galleryRoute as RouteModule).ErrorBoundary;
    if (!boundary) throw new Error("Missing gallery ErrorBoundary");
    const { query, dataRoutes } = createStaticHandler([{
      id: "gallery-500",
      path: "app/owner/gallery",
      loader: (galleryRoute as RouteModule).loader,
      Component: (galleryRoute as RouteModule).default,
      ErrorBoundary: boundary,
    }]);

    const result = await query(new Request("https://app.inkendar.es/app/owner/gallery"));
    if (result instanceof Response) throw new Error("Expected static handler context");
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);

    expect(result.statusCode).toBe(500);
    expect(html).toContain("Galería no disponible");
    expect(html).toContain("No se pudo cargar el contenido privado de la galería.");
    expect(html).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|provider detail|Aún no hay imágenes activas/iu);
  });
});
