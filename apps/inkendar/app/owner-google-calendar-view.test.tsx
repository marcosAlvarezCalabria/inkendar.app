import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarManagement } from "./routes/owner-calendars.js";

describe("owner Calendar management view", () => {
  it("renders safe connection state and one assignment selector per artist", () => {
    const html = renderToStaticMarkup(<CalendarManagement data={{
      connectionStatus: "ACTIVE",
      calendars: [
        { id: "ana@example.test", summary: "Agenda Ana", timeZone: "Europe/Madrid", accessRole: "writer", primary: false },
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
