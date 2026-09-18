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

import { AvailabilityManagement, CalendarManagement } from "./routes/owner-calendars.js";

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
});

it("renders persisted artist rules instead of defaults for a lossless resave",()=>{const rules={timeZone:"Pacific/Kiritimati",windows:[{weekday:6,start:"09:15",end:"12:45"}],slotIncrementMinutes:45,bufferBeforeMinutes:20,bufferAfterMinutes:25};const html=renderToStaticMarkup(<AvailabilityManagement artists={[{id:"50000000-0000-4000-8000-000000000001",displayName:"Ana",calendarId:"artist@test"}]} availabilityByArtist={{"50000000-0000-4000-8000-000000000001":rules}} actionData={undefined}/>);expect(html).toContain('value="Pacific/Kiritimati"');expect(html).toContain("6,09:15,12:45");expect(html).toContain('value="45"');expect(html).toContain('value="20"');expect(html).toContain('value="25"');});
