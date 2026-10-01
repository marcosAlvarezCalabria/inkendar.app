import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    Form: ({ children, ...props }: ComponentProps<"form">) => <form {...props}>{children}</form>,
  };
});

import {
  AvailabilityManagement,
  CalendarManagement,
  CalendarWorkspace,
  calendarPendingMutation,
  FreeChoiceDecisionList,
} from "./routes/owner-calendars.js";
import type { CalendarView } from "./routes/owner-calendars.js";

describe("owner Calendar management view", () => {
  it("preserves metadata but disables a legacy calendar that cannot reveal private event details", () => {
    const html = renderToStaticMarkup(<CalendarManagement data={{
      connectionStatus: "ACTIVE",
      calendars: [
        { id: "ana@example.test", summary: "Agenda Ana", timeZone: "Europe/Madrid", accessRole: "writerWithoutPrivateAccess", primary: false },
        { id: "safe@example.test", summary: "Agenda privada", timeZone: "Europe/Madrid", accessRole: "writer", primary: false },
        { id: "readonly@example.test", summary: "Solo lectura", timeZone: null, accessRole: "reader", primary: false },
      ],
      artists: [{ id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "ana@example.test" }],
    }} result="connected" />);
    expect(html).toContain("Conexión configurada");
    expect(html).toContain("Agenda Ana · incompatible con citas privadas");
    expect(html).toContain('<option value="ana@example.test" disabled="" selected="">');
    expect(html).toContain("Agenda privada");
    expect(html).not.toContain("Solo lectura");
    expect(html).toContain("Desasignar");
    expect(html).toContain("Conexión guardada; pendiente de verificación operativa");
  });

  it("warns when a saved assignment no longer appears in Google CalendarList", () => {
    const html = renderToStaticMarkup(<CalendarManagement data={{
      connectionStatus: "ACTIVE",
      calendars: [{ id: "other@example.test", summary: "Otra agenda", timeZone: "Europe/Madrid", accessRole: "owner", primary: false }],
      artists: [{ id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "missing@example.test" }],
    }} result={null} />);

    expect(html).toContain('data-tone="warning"');
    expect(html).toContain("Asignación no disponible");
    expect(html).toContain("La asignación guardada no aparece en la lista actual de Google");
    expect(html).not.toContain("Calendario asignado");
  });

  it.each([
    ["NOT_CONNECTED" as const, "Sin conexión", "Conectar Google Calendar"],
    ["ACTIVE" as const, "Conectado", "Reconectar"],
    ["REAUTH_REQUIRED" as const, "Reautorización necesaria", "Volver a autorizar"],
  ])("explains %s without confusing reconnect and disconnect", (connectionStatus, badge, action) => {
    const html = renderToStaticMarkup(<CalendarManagement data={{
      connectionStatus,
      calendars: [],
      artists: [],
    }} result={null} />);

    expect(html).toContain(badge);
    expect(html).toContain(action);
    expect(html.includes("Desconectar")).toBe(connectionStatus === "ACTIVE");
  });

  it("keeps connection empty state distinct from an active account with no artists", () => {
    const disconnected = renderToStaticMarkup(<CalendarManagement data={{ connectionStatus: "NOT_CONNECTED", calendars: [], artists: [] }} result={null} />);
    const connected = renderToStaticMarkup(<CalendarManagement data={{ connectionStatus: "ACTIVE", calendars: [], artists: [] }} result={null} />);

    expect(disconnected).toContain("Las asignaciones aparecerán cuando Google Calendar esté conectado");
    expect(connected).toContain("Todavía no hay artistas en el estudio");
    expect(connected).not.toContain("Las asignaciones aparecerán cuando Google Calendar esté conectado");
  });

  it("announces OAuth outcomes with semantic success, warning and error tones", () => {
    const data = { connectionStatus: "NOT_CONNECTED" as const, calendars: [], artists: [] };
    expect(renderToStaticMarkup(<CalendarManagement data={data} result="connected" />)).toContain('data-tone="success"');
    expect(renderToStaticMarkup(<CalendarManagement data={data} result="denied" />)).toContain('data-tone="warning"');
    expect(renderToStaticMarkup(<CalendarManagement data={data} result="failed" />)).toContain('data-tone="danger"');
  });
});

it("renders persisted artist rules instead of defaults for a lossless resave",()=>{const rules={timeZone:"Pacific/Kiritimati",windows:[{weekday:6,start:"09:15",end:"12:45"}],slotIncrementMinutes:45,bufferBeforeMinutes:20,bufferAfterMinutes:25};const html=renderToStaticMarkup(<AvailabilityManagement artists={[{id:"50000000-0000-4000-8000-000000000001",displayName:"Ana",calendarId:"artist@test"}]} availabilityByArtist={{"50000000-0000-4000-8000-000000000001":rules}} actionData={undefined}/>);expect(html).toContain('value="Pacific/Kiritimati"');expect(html).toContain("6,09:15,12:45");expect(html).toContain('value="45"');expect(html).toContain('value="20"');expect(html).toContain('value="25"');});

it("renders pending requests once and before progressive availability", () => {
  const artist = { id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "artist@example.test" };
  const request = { id: "93000000-0000-4000-8000-000000000001", status: "PENDING_OWNER_APPROVAL" as const, customerName: "Cliente Sintético", caseSummary: "Caso lunar", artistDisplayName: "Ana", startUtc: "2026-09-21T23:30:00.000Z", endUtc: "2026-09-22T00:30:00.000Z", expiresAt: "2026-09-21T20:00:00.000Z" };
  const view = { connectionStatus: "ACTIVE", calendars: [], artists: [artist], availabilityByArtist: { [artist.id]: null }, freeChoice: { status: "available", data: { cases: [], pendingRequests: [request, request] } } } satisfies CalendarView;
  const html = renderToStaticMarkup(<CalendarWorkspace data={view} result={null} actionData={undefined} pending={null} />);

  expect(html.indexOf("Decidir solicitudes de elección libre")).toBeLessThan(html.indexOf("Disponibilidad y enlaces por artista"));
  expect(html.match(/Cliente Sintético/gu)).toHaveLength(1);
  expect(html).toContain("Pendiente de decisión");
  expect(html).toContain("UTC");
  expect(html).toContain('dateTime="2026-09-21T23:30:00.000Z"');
  expect(html).toContain("<details");
});

it("preserves field names, intents and query actions inside each artist disclosure", () => {
  const artist = { id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "artist@example.test" };
  const html = renderToStaticMarkup(<AvailabilityManagement artists={[artist]} availabilityByArtist={{ [artist.id]: null }} freeChoice={{ cases: [{ id: "case-1", summary: "Caso sintético", artistProfileId: artist.id }], pendingRequests: [] }} actionData={undefined} pending={null} />);

  expect(html).toContain('action="?availability=1"');
  expect(html).toContain('name="intent" value="save-availability"');
  expect(html).toContain('name="intent" value="preview-availability"');
  expect(html).toContain('name="timeZone"');
  expect(html).toContain('name="windows"');
  expect(html).toContain('action="?freeChoice=1"');
  expect(html).toContain('name="tattooCaseId"');
  expect(html).toContain('name="expiresAt"');
});

it("shows safe granular pending copy only for the affected free-choice request", () => {
  const requests = [
    { id: "93000000-0000-4000-8000-000000000001", status: "PENDING_OWNER_APPROVAL" as const, customerName: "Cliente Uno", caseSummary: "Caso Uno", artistDisplayName: "Ana", startUtc: "2026-09-21T09:00:00.000Z", endUtc: "2026-09-21T10:00:00.000Z", expiresAt: "2026-09-21T08:00:00.000Z" },
    { id: "93000000-0000-4000-8000-000000000002", status: "APPROVING" as const, customerName: "Cliente Dos", caseSummary: "Caso Dos", artistDisplayName: "Ana", startUtc: "2026-09-22T09:00:00.000Z", endUtc: "2026-09-22T10:00:00.000Z", expiresAt: "2026-09-22T08:00:00.000Z" },
  ];
  const html = renderToStaticMarkup(<FreeChoiceDecisionList requests={requests} pending={{ kind: "decision", targetId: requests[0]!.id, intent: "approve" }} />);

  expect(html).toContain("Aprobando y reconciliando…");
  expect(html).toContain("Reintentar confirmación del mismo evento");
  expect(html).toContain("no afirma que la cita esté confirmada");
  expect(html.match(/disabled=""/gu)).toHaveLength(2);
});

it("derives pending state from current contract fields without inventing client state", () => {
  const decision = new FormData();
  decision.set("requestId", "request-1");
  decision.set("intent", "reject");
  expect(calendarPendingMutation(decision, "https://app.inkendar.es/app/owner/calendars?freeChoiceDecision=1")).toEqual({ kind: "decision", targetId: "request-1", intent: "reject" });

  const preview = new FormData();
  preview.set("artistProfileId", "artist-1");
  preview.set("intent", "preview-availability");
  expect(calendarPendingMutation(preview, "/app/owner/calendars?availability=1")).toEqual({ kind: "preview", targetId: "artist-1", intent: "preview-availability" });
});

it("renders preview results as human slots and treats an issued URL as ephemeral sensitive output", () => {
  const html = renderToStaticMarkup(<AvailabilityManagement artists={[]} availabilityByArtist={{}} actionData={{
    slots: [{ startUtc: "2026-09-21T23:30:00.000Z", endUtc: "2026-09-22T00:30:00.000Z", startLocal: "2026-09-22T00:30", endLocal: "2026-09-22T01:30" }],
    accessUrl: "https://app.inkendar.es/availability/synthetic-token",
    expiresAt: "2026-09-21T20:00:00.000Z",
  }} pending={null} />);

  expect(html).toContain("Resultado de la previsualización");
  expect(html).toContain("hora local guardada");
  expect(html).toContain("UTC");
  expect(html).toContain("Enlace sensible y efímero");
  expect(html).toContain("no se conserva aquí como historial");
  expect(html).toContain("previsualizar no confirma una cita");
});
