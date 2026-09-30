import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("./auth.server.js", () => ({ authHandlers: auth }));

import OwnerPanel, { loader } from "./routes/owner.js";

const routes = [{ id: "owner-panel", path: "app/owner", loader, Component: OwnerPanel }];

async function renderOwnerPanel() {
  auth.requireRole.mockResolvedValueOnce({
    access: { displayName: "Mara" },
    headers: new Headers(),
  });
  const { query, dataRoutes } = createStaticHandler(routes);
  const result = await query(new Request("https://app.inkendar.es/app/owner"));
  if (result instanceof Response) throw new Error("Expected static handler context");
  return renderToStaticMarkup(
    <StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />,
  );
}

describe("OWNER panel route", () => {
  it("renders the seven authorized areas in operating order with useful copy and real destinations", async () => {
    const html = await renderOwnerPanel();
    const cards = html.match(/<li\b[^>]*class="owner-area-card"[^>]*>[\s\S]*?<\/li>/gu) ?? [];
    const expected = [
      ["Conversaciones", "/app/owner/conversations"],
      ["Clientes", "/app/owner/customers"],
      ["Casos", "/app/owner/cases"],
      ["Calendario", "/app/owner/calendars"],
      ["Ofertas", "/app/owner/offers"],
      ["Galería", "/app/owner/gallery"],
      ["Equipo", "/app/owner/team"],
    ] as const;

    expect(html).toMatch(/<h1\b[^>]*>Hola, Mara<\/h1>/u);
    expect(cards).toHaveLength(expected.length);
    expected.forEach(([title, href], index) => {
      expect(cards[index]).toContain(`href="${href}"`);
      expect(cards[index]).toMatch(new RegExp(`<h3\\b[^>]*>${title}<\\/h3>`, "u"));
      expect(cards[index]).toMatch(/<p\b[^>]*>[^<]{20,}<\/p>/u);
    });
  });

  it("keeps the global panel navigation and logout without promising excluded capabilities", async () => {
    const html = await renderOwnerPanel();
    const current = html.match(/<a\b[^>]*aria-current="page"[^>]*>/gu) ?? [];

    expect(current.length).toBeGreaterThan(0);
    for (const link of current) expect(link).toContain('href="/app/owner"');
    expect(html).toContain('action="/logout"');
    expect(html).not.toMatch(/WhatsApp|Bizum|TPV|pagos?|facturaci[oó]n|m[eé]tricas?|actividad reciente|inteligencia artificial|recomendaciones?|inventario|stock|telemetr[ií]a|cabinas?/iu);
    expect(html).not.toMatch(/\bIA\b/u);
  });
});
