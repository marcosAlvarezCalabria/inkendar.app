import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, isRouteErrorResponse, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const availability = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const freeChoice = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
vi.mock("./owner-google-calendar.server.js", () => ({ ownerGoogleCalendarHandlers: handler }));
vi.mock("./owner-availability.server.js", () => ({ ownerAvailabilityHandlers: availability }));
vi.mock("./free-choice-availability.server.js", () => ({ ownerFreeChoiceAvailabilityHandlers: freeChoice }));
vi.mock("./free-choice-owner-decision.server.js", () => ({ ownerFreeChoiceDecisionHandlers: { action: vi.fn() } }));

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
    availability.loader.mockResolvedValueOnce(Response.json({ availabilityByArtist: {} }));
    const { query, dataRoutes } = createStaticHandler(routes);

    const result = await query(new Request("https://app.inkendar.es/app/owner/calendars"));

    if (result instanceof Response) throw new Error("Expected static handler context");
    expect(result.statusCode).toBe(200);
    expect(result.errors).toBeNull();
    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    expect(html).toContain("Google Calendar no está conectado");
  });
});

it("combines saved availability into the real route render",async()=>{const artist={id:"50000000-0000-4000-8000-000000000001",displayName:"Ana",calendarId:"artist@test"};handler.loader.mockResolvedValueOnce(Response.json({connectionStatus:"ACTIVE",calendars:[],artists:[artist]}));availability.loader.mockResolvedValueOnce(Response.json({availabilityByArtist:{[artist.id]:{timeZone:"Pacific/Kiritimati",windows:[{weekday:6,start:"09:15",end:"12:45"}],slotIncrementMinutes:45,bufferBeforeMinutes:20,bufferAfterMinutes:25}}}));const {query,dataRoutes}=createStaticHandler(routes);const result=await query(new Request("https://app.inkendar.es/app/owner/calendars"));if(result instanceof Response)throw new Error("Expected context");const html=renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes,result)} context={result}/>);expect(availability.loader).toHaveBeenCalledOnce();expect(html).toContain('value="Pacific/Kiritimati"');expect(html).toContain("6,09:15,12:45");expect(html).toContain('value="45"');});

it("loads availability only for artists authorized by the management response", async () => {
  const authorizedArtist = { id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: null };
  handler.loader.mockResolvedValueOnce(Response.json({ connectionStatus: "ACTIVE", calendars: [], artists: [authorizedArtist] }));
  availability.loader.mockResolvedValueOnce(Response.json({ availabilityByArtist: { [authorizedArtist.id]: null } }));
  const injected = Array.from({ length: 101 }, (_, index) => `attacker-${index}`)
    .map((id) => `artistProfileId=${id}`)
    .join("&");

  const response = await loader({
    request: new Request(`https://app.inkendar.es/app/owner/calendars?${injected}`),
  } as never);

  expect(response.status).toBe(200);
  const forwarded = availability.loader.mock.calls.at(-1)?.[0] as Request;
  expect(new URL(forwarded.url).searchParams.getAll("artistProfileId")).toEqual([authorizedArtist.id]);
});

it("renders approve/reject controls and safe retry for OWNER decisions",async()=>{const artist={id:"50000000-0000-4000-8000-000000000001",displayName:"Ana",calendarId:"artist@test"};handler.loader.mockResolvedValueOnce(Response.json({connectionStatus:"ACTIVE",calendars:[],artists:[artist]}));availability.loader.mockResolvedValueOnce(Response.json({availabilityByArtist:{[artist.id]:null}}));freeChoice.loader.mockResolvedValueOnce(Response.json({cases:[],pendingRequests:[{id:"93000000-0000-4000-8000-000000000001",status:"PENDING_OWNER_APPROVAL",customerName:"Client",caseSummary:"Case",artistDisplayName:"Ana",startUtc:"2026-09-21T09:00:00.000Z",endUtc:"2026-09-21T10:00:00.000Z",expiresAt:"2026-09-21T08:00:00.000Z"},{id:"93000000-0000-4000-8000-000000000002",status:"APPROVING",customerName:"Client 2",caseSummary:"Case 2",artistDisplayName:"Ana",startUtc:"2026-09-22T09:00:00.000Z",endUtc:"2026-09-22T10:00:00.000Z",expiresAt:"2026-09-22T08:00:00.000Z"}]}));const {query,dataRoutes}=createStaticHandler(routes);const result=await query(new Request("https://app.inkendar.es/app/owner/calendars"));if(result instanceof Response)throw new Error("Expected context");const html=renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes,result)} context={result}/>);expect(html).toContain("Aprobar y confirmar");expect(html).toContain("Rechazar");expect(html).toContain("Reintentar confirmación");expect(html).toContain("El reintento recupera el mismo evento.");});