import { describe, expect, it, vi } from "vitest";
import { ConversationProviderUnavailableError, createConversationsService, createCustomerCasesService, type ConversationLinksRepositoryPort, type ConversationOutboundRepositoryPort, type ConversationProviderPort, type ConversationWebhookRepositoryPort, type CustomerCasesRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerConversationsHandlers, type OwnerConversationsContext } from "./owner-conversations.server.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const access: AuthorizedAccess = { displayName: "Owner", role: "OWNER", studioId, userId: "10000000-0000-4000-8000-000000000001" };

function context(): OwnerConversationsContext {
  const provider: ConversationProviderPort = {
    listConversations: vi.fn(async () => ({ items: [{ id: "42", inboxId: "7", status: "open", channel: "web", contactName: "Synthetic", unreadCount: 1, lastActivityAt: "2026-09-14T10:00:00.000Z", canReply: true } as const], totalCount: 26 })),
    getConversation: vi.fn(async () => ({ id: "42", inboxId: "7", canReply: true, messages: [], before: null })),
    sendReply: vi.fn(async () => ({ externalMessageId: "84" })),
  };
  const links: ConversationLinksRepositoryPort = { listLinks: vi.fn(async () => []), saveLink: vi.fn() };
  const outbound: ConversationOutboundRepositoryPort = { claim: vi.fn(async () => ({ kind: "CLAIMED" as const, operationId: "90000000-0000-4000-8000-000000000001" })), markSucceeded: vi.fn(), markFailed: vi.fn(), markUnknown: vi.fn() };
  const webhook: ConversationWebhookRepositoryPort = { record: vi.fn() };
  const customers: CustomerCasesRepositoryPort = { listCustomers: vi.fn(async () => []), findCustomer: vi.fn(async () => null), createCustomer: vi.fn(), updateCustomer: vi.fn(), listTattooCases: vi.fn(async () => []), findTattooCase: vi.fn(async () => null), createTattooCase: vi.fn(), updateTattooCase: vi.fn(), listArtists: vi.fn(async () => []), artistExists: vi.fn(async () => false) };
  return { conversations: createConversationsService({ externalAccountId: "3", provider, links, outbound, customerCases: customers, webhooks: webhook }), customerCases: createCustomerCasesService(customers) };
}

const authorize = async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) });

describe("owner conversations handlers", () => {
  it("returns a private paginated inbox after OWNER authorization", async () => {
    const createContext = vi.fn(() => context());
    const handlers = createOwnerConversationsHandlers({ authorize, createContext, createKey: () => "91000000-0000-4000-8000-000000000001" });
    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations?page=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).conversations.nextPage).toBe(2);
    expect(createContext).toHaveBeenCalledWith(expect.any(Request), studioId);
  });

  it("returns an empty private page without provider composition when no connection exists", async () => {
    const handlers = createOwnerConversationsHandlers({ authorize, createContext: () => null, createKey: crypto.randomUUID });
    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).conversations.items).toEqual([]);
  });

  it("rejects invalid pagination before composing provider state", async () => {
    const createContext = vi.fn(() => context());
    const handlers = createOwnerConversationsHandlers({ authorize, createContext, createKey: crypto.randomUUID });
    const caught = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations?page=1001")).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(400);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("returns an existing authorization response without composing provider credentials", async () => {
    const createContext = vi.fn(() => context());
    const denied = new Response("Denied", { status: 403 });
    const handlers = createOwnerConversationsHandlers({ authorize: async () => denied, createContext, createKey: crypto.randomUUID });
    expect(await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations"))).toBe(denied);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("rejects cross-origin actions before authorization", async () => {
    const guard = vi.fn();
    const handlers = createOwnerConversationsHandlers({ authorize: guard, createContext: () => context(), createKey: crypto.randomUUID });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/conversations", { method: "POST", headers: { Origin: "https://evil.example" }, body: new FormData() }));
    expect(response.status).toBe(403);
    expect(guard).not.toHaveBeenCalled();
  });

  it("validates reply content before composing provider or service role", async () => {
    const createContext = vi.fn(() => context());
    const handlers = createOwnerConversationsHandlers({ authorize, createContext, createKey: crypto.randomUUID });
    const form = new FormData();
    form.set("intent", "reply"); form.set("conversationId", "42"); form.set("content", "   "); form.set("idempotencyKey", "91000000-0000-4000-8000-000000000001");
    const response = await handlers.action(mutation(form));
    expect(response.status).toBe(400);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("dispatches an idempotent reply for the authorized studio", async () => {
    const current = context();
    const reply = vi.spyOn(current.conversations, "reply");
    const handlers = createOwnerConversationsHandlers({ authorize, createContext: () => current, createKey: crypto.randomUUID });
    const form = new FormData();
    form.set("intent", "reply"); form.set("conversationId", "42"); form.set("content", "Private reply"); form.set("idempotencyKey", "91000000-0000-4000-8000-000000000001");
    const request = mutation(form);
    const response = await handlers.action(request);
    expect(reply).toHaveBeenCalledWith(studioId, "42", "Private reply", "91000000-0000-4000-8000-000000000001", request.signal);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/owner/conversations?conversation=42");
  });

  it("throws a private generic response when loading the provider fails", async () => {
    const current = context();
    vi.spyOn(current.conversations, "listInbox").mockRejectedValueOnce(new ConversationProviderUnavailableError());
    const handlers = createOwnerConversationsHandlers({ authorize, createContext: () => current, createKey: crypto.randomUUID });
    const caught = await handlers.loader(new Request("https://app.inkendar.es/app/owner/conversations")).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(503);
    expect((caught as Response).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

function mutation(body: FormData): Request {
  return new Request("https://app.inkendar.es/app/owner/conversations", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body });
}
