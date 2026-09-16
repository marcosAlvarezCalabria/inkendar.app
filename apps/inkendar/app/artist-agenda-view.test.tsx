import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArtistAgenda } from "./routes/artist.js";

describe("artist agenda view", () => {
  it("renders an accessible read-only appointment without private identifiers", () => {
    const html = renderToStaticMarkup(<ArtistAgenda appointments={[{
      startUtc: "2026-09-20T09:00:00.000Z",
      endUtc: "2026-09-20T10:00:00.000Z",
      customerDisplayName: "Cliente sintético",
      caseSummary: "Pieza floral",
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
