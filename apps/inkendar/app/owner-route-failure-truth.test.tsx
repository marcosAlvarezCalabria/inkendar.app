import { createStaticHandler, isRouteErrorResponse } from "react-router";
import type { RouteObject } from "react-router";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
const conversations = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));
const records = vi.hoisted(() => ({
  customersLoader: vi.fn(),
  customerAction: vi.fn(),
  casesLoader: vi.fn(),
  caseAction: vi.fn(),
}));
const gallery = vi.hoisted(() => ({ loader: vi.fn(), action: vi.fn() }));

vi.mock("./auth.server.js", () => ({ authHandlers: auth }));
vi.mock("./owner-conversations.server.js", () => ({ ownerConversationsHandlers: conversations }));
vi.mock("./owner-customer-cases.server.js", () => ({ ownerCustomerCasesHandlers: records }));
vi.mock("./owner-gallery.server.js", () => ({ ownerGalleryHandlers: gallery }));

import OwnerPanel, { loader as ownerLoader } from "./routes/owner.js";
import OwnerConversations, { loader as conversationsLoader } from "./routes/owner-conversations.js";
import OwnerCustomers, { loader as customersLoader } from "./routes/owner-customers.js";
import OwnerCases, { loader as casesLoader } from "./routes/owner-cases.js";
import OwnerGallery, { loader as galleryLoader } from "./routes/owner-gallery.js";

type RouteDefinition = RouteObject & Readonly<{ id: string; path: string }>;

async function queryFailure(route: RouteDefinition, status: 403 | 500) {
  const { query } = createStaticHandler([route]);
  const result = await query(new Request(`https://app.inkendar.es/${route.path}`));
  expect(result).not.toBeInstanceOf(Response);
  if (result instanceof Response) throw new Error("Expected static handler context");
  expect(result.statusCode).toBe(status);
  const routeError = result.errors?.[route.id];
  expect(isRouteErrorResponse(routeError)).toBe(true);
  if (!isRouteErrorResponse(routeError)) throw new Error("Expected route error response");
  expect(routeError.data === null || routeError.data === "").toBe(true);
  expect(result.loaderData[route.id]).toBeUndefined();
}

describe("OWNER route failure truth", () => {
  it("throws an OWNER-panel 403 instead of exposing it as loader data", async () => {
    auth.requireRole.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await queryFailure({ id: "owner", path: "app/owner", loader: ownerLoader, Component: OwnerPanel }, 403);
  });

  it("throws a conversations 403 instead of consuming it as a conversation projection", async () => {
    conversations.loader.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    await queryFailure({ id: "conversations", path: "app/owner/conversations", loader: conversationsLoader, Component: OwnerConversations }, 403);
  });

  it("throws a customers 403 instead of consuming it as a customer projection", async () => {
    records.customersLoader.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    await queryFailure({ id: "customers", path: "app/owner/customers", loader: customersLoader, Component: OwnerCustomers }, 403);
  });

  it("throws a cases 403 instead of consuming it as a case projection", async () => {
    records.casesLoader.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    await queryFailure({ id: "cases", path: "app/owner/cases", loader: casesLoader, Component: OwnerCases }, 403);
  });

  it.each([403, 500] as const)("throws a gallery %i instead of consuming an incompatible JSON shape", async (status) => {
    gallery.loader.mockResolvedValueOnce(Response.json({ error: "safe failure" }, { status }));
    await queryFailure({ id: "gallery", path: "app/owner/gallery", loader: galleryLoader, Component: OwnerGallery }, status);
  });
});
