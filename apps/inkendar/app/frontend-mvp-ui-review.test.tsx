import { describe, expect, it } from "vitest";

type ReviewScenario = Readonly<{ surface: string; width: number; html: string }>;

const canonicalSurfaces = [
  "login",
  "owner-panel",
  "owner-conversations",
  "owner-customers",
  "owner-cases",
  "owner-calendars",
  "owner-offers",
  "owner-gallery",
  "owner-team",
  "artist-agenda",
  "public-offer",
  "public-availability",
] as const;

describe("frontend MVP private evidence catalog", () => {
  it("renders all twelve real views across the durable review viewports", async () => {
    const review = await import("./ui/fixtures/ui-review.js") as unknown as {
      uiReviewSurfaceCatalog?: readonly string[];
      renderUiReviewScenarios: (assets: { stylesheetHref: string; fontStylesheetHref: string }) => readonly ReviewScenario[];
    };
    expect(review.uiReviewSurfaceCatalog).toEqual(canonicalSurfaces);
    const scenarios = review.renderUiReviewScenarios({ stylesheetHref: "styles.css", fontStylesheetHref: "font.css" });
    const canonicalScenarios = scenarios.filter(({ surface }) => canonicalSurfaces.includes(surface as typeof canonicalSurfaces[number]));
    expect(new Set(canonicalScenarios.map(({ surface }) => surface))).toEqual(new Set(canonicalSurfaces));
    expect(new Set(canonicalScenarios.map(({ width }) => width))).toEqual(new Set([320, 375, 768, 1280]));

    const htmlBySurface = new Map(canonicalSurfaces.map((surface) => [surface, canonicalScenarios.filter((scenario) => scenario.surface === surface).map(({ html }) => html).join("\n")]));
    expect(htmlBySurface.get("login")).toContain("Accede a tu estudio");
    expect(htmlBySurface.get("owner-panel")).toContain("Panel del estudio");
    expect(htmlBySurface.get("owner-conversations")).toContain("Bandeja del estudio");
    expect(htmlBySurface.get("owner-customers")).toContain("Clientes del estudio");
    expect(htmlBySurface.get("owner-cases")).toContain("Casos del estudio");
    expect(htmlBySurface.get("owner-calendars")).toContain("Decidir solicitudes de elección libre");
    expect(htmlBySurface.get("owner-offers")).toContain("Ofertas del estudio");
    expect(htmlBySurface.get("owner-gallery")).toContain("Imágenes activas");
    expect(htmlBySurface.get("owner-team")).toContain("Miembros del estudio");
    expect(htmlBySurface.get("artist-agenda")).toContain("Próximas citas");
    expect(htmlBySurface.get("public-offer")).toContain("Opciones reservadas provisionalmente");
    expect(htmlBySurface.get("public-availability")).toContain("Huecos disponibles");
  }, 15_000);

  it("uses only unmistakably synthetic phone numbers", async () => {
    const { renderUiReviewScenarios } = await import("./ui/fixtures/ui-review.js");
    const html = renderUiReviewScenarios({ stylesheetHref: "styles.css", fontStylesheetHref: "font.css" }).map(({ html: scenarioHtml }) => scenarioHtml).join("\n");
    const phoneNumbers = html.match(/\+\d[\d\s-]{7,}\d/gu) ?? [];
    expect(phoneNumbers.length).toBeGreaterThan(0);
    for (const phone of phoneNumbers) expect(phone.replaceAll(/[\s-]/gu, "")).toMatch(/^\+999/u);
  });
});
