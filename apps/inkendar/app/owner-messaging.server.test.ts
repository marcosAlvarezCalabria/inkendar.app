import { describe, expect, it, vi } from "vitest";
import { MessagingConnectionUnavailableError, ReplyOutcomeUnknownError, createMessagingService, type ConversationMessage, type ConversationSummary, type MessagingRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerMessagingHandlers } from "./owner-messaging.server.js";

const access: AuthorizedAccess = { displayName: "Owner", role: "OWNER", studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };

function service() {
  return {
    listOpenConversations: vi.fn(async () => ({ items: [] as readonly ConversationSummary[], page: 1, pageSize: 25 as const, totalCount: 0, previousPage: null, nextPage: null })),
    getConversationMessages: vi.fn(async () => ({ items: [] as readonly ConversationMessage[], before: null })),
    sendConversationReply: vi.fn(async () => ({ externalMessageId: "9", repeated: false })),
  };
}

describe("owner messaging handlers", () => {
  it("uses the authorized studio and returns private responses", async () => {
    const messaging = service();
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) }), service: () => messaging, createKey: () => "90000000-0000-4000-8000-000000000001" });
    const request = new Request("https://app.inkendar.es/app/owner/inbox");
    const response = await handlers.inboxLoader(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
    expect(messaging.listOpenConversations).toHaveBeenCalledWith(access.studioId, 1, request.signal);
  });

  it("returns an empty private inbox without composing provider configuration", async () => {
    const repo: MessagingRepositoryPort = {
      findActiveConnection: vi.fn(async () => null), upsertConversationLinks: vi.fn(async () => undefined), findConversationLink: vi.fn(async () => null),
      claimOutboundOperation: vi.fn(async () => ({ kind: "PENDING" as const })), markOutboundSucceeded: vi.fn(async () => undefined),
      markOutboundFailed: vi.fn(async () => undefined), markOutboundUnknown: vi.fn(async () => undefined),
    };
    const createProvider = vi.fn(() => { throw new Error("environment must not be loaded"); });
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: () => createMessagingService(repo, createProvider), createKey: crypto.randomUUID });
    const response = await handlers.inboxLoader(new Request("https://app.inkendar.es/app/owner/inbox"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ conversations: { items: [], page: 1, pageSize: 25, totalCount: 0, previousPage: null, nextPage: null } });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("passes bounded conversation pages and one older-message cursor", async () => {
    const messaging = service();
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: () => messaging, createKey: crypto.randomUUID });
    await handlers.inboxLoader(new Request("https://app.inkendar.es/app/owner/inbox?page=2"));
    await handlers.conversationLoader(new Request("https://app.inkendar.es/app/owner/inbox/42?before=100"), "42");
    expect(messaging.listOpenConversations).toHaveBeenCalledWith(access.studioId, 2, expect.any(AbortSignal));
    expect(messaging.getConversationMessages).toHaveBeenCalledWith(access.studioId, "42", "100", expect.any(AbortSignal));
  });

  it.each([
    ["invalid page", "https://app.inkendar.es/app/owner/inbox?page=1001", "inbox"],
    ["duplicate before", "https://app.inkendar.es/app/owner/inbox/42?before=100&before=99", "conversation"],
    ["before plus after", "https://app.inkendar.es/app/owner/inbox/42?before=100&after=101", "conversation"],
  ])("rejects %s without composing messaging", async (_case, url, loader) => {
    const createService = vi.fn(() => service());
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: createService, createKey: crypto.randomUUID });
    const response = loader === "inbox" ? await handlers.inboxLoader(new Request(url)) : await handlers.conversationLoader(new Request(url), "42");
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createService).not.toHaveBeenCalled();
  });

  it("returns the existing guard denial before calling a use case", async () => {
    const messaging = service();
    const handlers = createOwnerMessagingHandlers({ authorize: async () => new Response("Acceso denegado", { status: 403 }), service: () => messaging, createKey: crypto.randomUUID });
    expect((await handlers.inboxLoader(new Request("https://app.inkendar.es/app/owner/inbox"))).status).toBe(403);
    expect(messaging.listOpenConversations).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin reply before authorization and form parsing", async () => {
    const authorize = vi.fn(); const messaging = service();
    const handlers = createOwnerMessagingHandlers({ authorize, service: () => messaging, createKey: crypto.randomUUID });
    const response = await handlers.replyAction(new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers: { Origin: "https://evil.example" }, body: new FormData() }), "42");
    expect(response.status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
    expect(messaging.sendConversationReply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing provenance", {}],
    ["cross-site fetch metadata", { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "cross-site" }],
  ])("rejects %s before authorization or messaging composition", async (_case, headers) => {
    const authorize = vi.fn();
    const createService = vi.fn(() => service());
    const handlers = createOwnerMessagingHandlers({ authorize, service: createService, createKey: crypto.randomUUID });
    const response = await handlers.replyAction(new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers, body: new FormData() }), "42");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(authorize).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();
  });

  it("validates the complete form before loading provider credentials or persistence", async () => {
    const createService = vi.fn(() => { throw new Error("credentials must not be loaded"); });
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: createService, createKey: crypto.randomUUID });
    const body = new FormData(); body.set("reply", "   "); body.set("idempotencyKey", "90000000-0000-4000-8000-000000000001");
    const response = await handlers.replyAction(new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body }), "42");
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createService).not.toHaveBeenCalled();
  });

  it("passes only server-authorized tenant and returns a safe redirect", async () => {
    const messaging = service();
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: () => messaging, createKey: crypto.randomUUID });
    const body = new FormData(); body.set("reply", "Mensaje privado"); body.set("idempotencyKey", "90000000-0000-4000-8000-000000000001");
    const request = new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body });
    const response = await handlers.replyAction(request, "42");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/owner/inbox/42");
    expect(messaging.sendConversationReply).toHaveBeenCalledWith(access.studioId, "42", "Mensaje privado", "90000000-0000-4000-8000-000000000001", request.signal);
  });

  it("reports an ambiguous send without echoing message content", async () => {
    const messaging = service(); vi.mocked(messaging.sendConversationReply).mockRejectedValue(new ReplyOutcomeUnknownError());
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: () => messaging, createKey: crypto.randomUUID });
    const body = new FormData(); body.set("reply", "Sensitive full message"); body.set("idempotencyKey", "90000000-0000-4000-8000-000000000001");
    const response = await handlers.replyAction(new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body }), "42");
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Sensitive full message");
  });

  it("returns the contracted 503 when messaging is not configured", async () => {
    const messaging = service(); vi.mocked(messaging.sendConversationReply).mockRejectedValue(new MessagingConnectionUnavailableError());
    const handlers = createOwnerMessagingHandlers({ authorize: async () => ({ access, headers: new Headers() }), service: () => messaging, createKey: crypto.randomUUID });
    const body = new FormData(); body.set("reply", "Hola"); body.set("idempotencyKey", "90000000-0000-4000-8000-000000000001");
    const response = await handlers.replyAction(new Request("https://app.inkendar.es/app/owner/inbox/42", { method: "POST", headers: { Origin: "https://app.inkendar.es" }, body }), "42");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("studio-north");
  });
});
