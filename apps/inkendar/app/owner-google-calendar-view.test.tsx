import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvailabilityManagement, CalendarManagement } from "./routes/owner-calendars.js";

describe("owner Calendar management view", () => {
  it("renders safe connection state and one assignment selector per artist", () => {
    const html = renderToStaticMarkup(<CalendarManagement data={{
      connectionStatus: "ACTIVE",
      calendars: [
        { id: "ana@example.test", summary: "Agenda Ana", timeZone: "Europe/Madrid", accessRole: "writerWithoutPrivateAccess", primary: false },
        { id: "readonly@example.test", summary: "Solo lectura", timeZone: null, accessRole: "reader", primary: false },
      ],
      artists: [{ id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "ana@example.test" }],
    }} result="connected" />);
    expect(html).toContain("Conexión configurada");
    expect(html).toContain("Agenda Ana");
    expect(html).not.toContain("Solo lectura");
    expect(html).toContain("Desasignar");
    expect(html).toContain("Conexión guardada; pendiente de verificación operativa");
  });
});

it("renders persisted artist rules instead of defaults for a lossless resave",()=>{const rules={timeZone:"Pacific/Kiritimati",windows:[{weekday:6,start:"09:15",end:"12:45"}],slotIncrementMinutes:45,bufferBeforeMinutes:20,bufferAfterMinutes:25};const html=renderToStaticMarkup(<AvailabilityManagement artists={[{id:"50000000-0000-4000-8000-000000000001",displayName:"Ana",calendarId:"artist@test"}]} availabilityByArtist={{"50000000-0000-4000-8000-000000000001":rules}} actionData={undefined}/>);expect(html).toContain('value="Pacific/Kiritimati"');expect(html).toContain("6,09:15,12:45");expect(html).toContain('value="45"');expect(html).toContain('value="20"');expect(html).toContain('value="25"');});
