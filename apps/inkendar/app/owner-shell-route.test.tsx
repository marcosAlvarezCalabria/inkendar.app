import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({ customersLoader: vi.fn(), customerAction: vi.fn() }));
vi.mock("./owner-customer-cases.server.js", () => ({ ownerCustomerCasesHandlers: handler }));

import OwnerCustomers, { action, loader } from "./routes/owner-customers.js";

const routes = [{ id: "owner-customers", path: "app/owner/customers", loader, action, Component: OwnerCustomers }];

describe("OWNER route inside the shared shell", () => {
  it("marks the current area and keeps the existing form contract", async () => {
    handler.customersLoader.mockResolvedValueOnce(Response.json({ customers: [{ id: "60000000-0000-4000-8000-000000000001", name: "Cliente sintético", email: "cliente@example.invalid", phone: null, status: "ACTIVE" }] }));
    const { query, dataRoutes } = createStaticHandler(routes);
    const result = await query(new Request("https://app.inkendar.es/app/owner/customers"));
    if (result instanceof Response) throw new Error("Expected static handler context");

    const html = renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes, result)} context={result} />);
    const current = html.match(/<a\b[^>]*aria-current="page"[^>]*>/gu) ?? [];

    expect(current.length).toBeGreaterThan(0);
    for (const tag of current) expect(tag).toContain('href="/app/owner/customers"');
    expect(html.match(/<main\b/gu)).toHaveLength(1);
    expect(html).toMatch(/<h1\b[^>]*>Clientes<\/h1>/u);
    expect(html).toContain('name="intent" value="create"');
    expect(html).toContain('name="intent" value="update"');
    expect(html).toContain('action="/logout"');
    expect(html).toContain("Cliente sintético");
  });
});
