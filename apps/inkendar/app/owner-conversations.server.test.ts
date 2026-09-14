import { describe, expect, it, vi } from "vitest";

import { ConversationProviderUnavailableError, createConversationsService, createCustomerCasesService, type ConversationLinksRepositoryPort, type ConversationProviderPort, type ConversationWebhookRepositoryPort, type CustomerCasesRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerConversationsHandlers, type OwnerConversationsContext } from "./owner-conversations.server.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const access: AuthorizedAccess = { displayName: "Owner", role: "OWNER", studioId, userId: "10000000-0000-4000-8000-000000000001" };

function context(): OwnerConversationsContext {
  const provider: ConversationProviderPort = {
    listConversations: vi.fn(async () => [{ id: "42", inboxId: "7", status: "open", channel: "web", contactName: "Synthetic", unreadCount: 1, lastActivityAt: "2026-09-14T10:00:00.000Z", canReply: true } as const]),
    getConversation: vi.fn(async () => ({ id: "42", inboxId: "7", canReply: true, messages: [] })),
    sendReply: vi.fn(async () => undefined),
  };
  const links: ConversationLinksRepositoryPort = { listLinks: vi.fn(async () => []), saveLink: vi.fn() };
  const webhook: ConversationWebhookRepositoryPort = { record: vi.fn() };
  const customerCasesRepository: CustomerCasesRepositoryPort = {
    listCustomers: vi.fn(async () => []), findCustomer: vi.fn(async () => null), createCustomer: vi.fn(), updateCustomer: vi.fn(),
    listTattooCases: vi.fn(async () => []), findTattooCase: vi.fn(async () => null), createTattooCase: vi.fn(), updateTattooCase: vi.fn(),
    listArtists: vi.fn(async () => []), artistExists: vi.fn(async () => false),
  };
  return {
    conversations: createConversationsService({ externalAccountId: "3", provider, links, customerCases: customerCasesRepository, webhooks: webhook }),
    customerCases: createCustomerCasesService(customerCasesRepository),
  };
}

describe("owner conversations handlers", () => {
  it("authorizes OWNER before listing tenant data and returns private no-store", async () => {
    const createContext = vi.fn(() => context());
    const handlers = createOwnerConversationsHandlers({ authorize: async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) }), createContext });
    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createContext).toHaveBeenCalledWith(expect.any(Request), studioId);
  });

  it("returns an existing authorization response without composing provider credentials", async () => {
    const createContext = vi.fn(() => context());
    const denied = new Response("Acceso denegado", { status: 403 });
    const handlers = createOwnerConversationsHandlers({ authorize: async () => denied, createContext });
    expect(await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations"))).toBe(denied);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("rejects cross-origin actions before authorization or form parsing", async () => {
    const authorize = vi.fn(async () => ({ access, headers: new Headers() }));
    const handlers = createOwnerConversationsHandlers({ authorize, createContext: () => context() });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/conversations", { method: "POST", headers: { Origin: "https://evil.example" }, body: new FormData() }));
    expect(response.status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("dispatches one reply with the authorized studio and keeps content out of redirect URL", async () => {
    const current = context();
    const reply = vi.spyOn(current.conversations, "reply");
    const handlers = createOwnerConversationsHandlers({ authorize: async () => ({ access, headers: new Headers() }), createContext: () => current });
    const form = new FormData(); form.set("intent", "reply"); form.set("conversationId", "42"); form.set("content", "Private reply");
    const response = await handlers.action(mutation(form));
    expect(reply).toHaveBeenCalledWith(studioId, "42", "Private reply");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/owner/conversations?conversation=42");
    expect(response.headers.get("Location")).not.toContain("Private");
  });

  it("throws a private generic response when loading the provider fails", async () => {
    const current = context();
    vi.spyOn(current.conversations, "listInbox").mockRejectedValueOnce(new ConversationProviderUnavailableError());
    const handlers = createOwnerConversationsHandlers({ authorize: async () => ({ access, headers: new Headers() }), createContext: () => current });

    const caught = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations")).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(503);
    expect((caught as Response).headers.get("Cache-Control")).toBe("private, no-store");
    expect(await (caught as Response).text()).not.toContain("provider");
  });

  it("does not accept non-POST mutations", async () => {
    const authorize = vi.fn(async () => ({ access, headers: new Headers() }));
    const handlers = createOwnerConversationsHandlers({ authorize, createContext: () => context() });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/conversations", {
      method: "PUT",
      headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" },
      body: new URLSearchParams({ intent: "reply", conversationId: "42", content: "Hola" }),
    }));

    expect(response.status).toBe(405);
    expect(authorize).not.toHaveBeenCalled();
  });
});

function mutation(body: FormData): Request {
  return new Request("https://app.inkendar.es/app/owner/conversations", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body });
}
