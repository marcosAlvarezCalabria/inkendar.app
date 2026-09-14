import { describe, expect, it, vi } from "vitest";

import {
  ConversationCannotReplyError,
  ConversationCaseCustomerMismatchError,
  ConversationCustomerNotFoundError,
  createConversationsService,
  type ConversationLinksRepositoryPort,
  type ConversationProviderPort,
  type ConversationWebhookRepositoryPort,
  type CustomerCaseLookupPort,
} from "./conversations.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const caseId = "70000000-0000-4000-8000-000000000001";

function dependencies() {
  const provider: ConversationProviderPort = {
    listConversations: vi.fn(async () => [{
      id: "42", inboxId: "7", status: "open", channel: "instagram", contactName: "Synthetic client",
      unreadCount: 2, lastActivityAt: "2026-09-14T10:00:00.000Z", canReply: true,
    } as const]),
    getConversation: vi.fn(async () => ({
      id: "42", inboxId: "7", canReply: true,
      messages: [{ id: "84", direction: "incoming", content: "Hola", createdAt: "2026-09-14T10:00:00.000Z" }],
    } as const)),
    sendReply: vi.fn(async () => undefined),
  };
  const links: ConversationLinksRepositoryPort = {
    listLinks: vi.fn(async () => [{ id: "80000000-0000-4000-8000-000000000001", studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: caseId, lastExternalMessageId: null, lastActivityAt: null }]),
    saveLink: vi.fn(async (input) => ({ id: "80000000-0000-4000-8000-000000000001", lastExternalMessageId: null, lastActivityAt: null, ...input })),
  };
  const customerCases: CustomerCaseLookupPort = {
    findCustomer: vi.fn(async () => ({ id: customerId, studioId })),
    findTattooCase: vi.fn(async () => ({ id: caseId, studioId, customerId })),
  };
  const webhooks: ConversationWebhookRepositoryPort = { record: vi.fn(async () => "ACCEPTED" as const) };
  return { provider, links, customerCases, webhooks };
}

describe("conversations service", () => {
  it("joins provider summaries with tenant-scoped customer/case links", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await expect(service.listInbox(studioId)).resolves.toEqual([
      expect.objectContaining({ id: "42", link: expect.objectContaining({ customerId, tattooCaseId: caseId }) }),
    ]);
    expect(deps.links.listLinks).toHaveBeenCalledWith(studioId, "3");
  });

  it("loads a normalized conversation id and sends one normalized reply", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await service.reply(studioId, " 042 ", "  Hola\r\nMaría  ");

    expect(deps.provider.getConversation).toHaveBeenCalledWith("42");
    expect(deps.provider.sendReply).toHaveBeenCalledTimes(1);
    expect(deps.provider.sendReply).toHaveBeenCalledWith("42", "Hola\nMaría");
  });

  it("does not dispatch when the provider marks a conversation non-replyable", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.getConversation).mockResolvedValueOnce({ id: "42", inboxId: "7", canReply: false, messages: [] });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await expect(service.reply(studioId, "42", "Hola")).rejects.toBeInstanceOf(ConversationCannotReplyError);
    expect(deps.provider.sendReply).not.toHaveBeenCalled();
  });

  it("creates an idempotent link only after checking customer and case ownership", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await service.link(studioId, { conversationId: "42", customerId, tattooCaseId: caseId });

    expect(deps.links.saveLink).toHaveBeenCalledWith({
      studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: caseId,
    });
  });

  it("rejects a case belonging to another customer before persistence", async () => {
    const deps = dependencies();
    vi.mocked(deps.customerCases.findTattooCase).mockResolvedValueOnce({ id: caseId, studioId, customerId: "60000000-0000-4000-8000-000000000002" });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await expect(service.link(studioId, { conversationId: "42", customerId, tattooCaseId: caseId })).rejects.toBeInstanceOf(ConversationCaseCustomerMismatchError);
    expect(deps.links.saveLink).not.toHaveBeenCalled();
  });

  it("rejects lookup results that do not match the authorized tenant", async () => {
    const deps = dependencies();
    vi.mocked(deps.customerCases.findCustomer).mockResolvedValueOnce({
      id: customerId,
      studioId: "20000000-0000-4000-8000-000000000002",
    });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });

    await expect(service.link(studioId, { conversationId: "42", customerId })).rejects.toBeInstanceOf(ConversationCustomerNotFoundError);
    expect(deps.provider.getConversation).not.toHaveBeenCalled();
    expect(deps.links.saveLink).not.toHaveBeenCalled();
  });

  it("delegates normalized webhook receipts to the atomic idempotency port", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    const event = { deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", externalMessageId: "84", occurredAt: "2026-09-14T10:00:00.000Z" } as const;

    await expect(service.ingest(studioId, event)).resolves.toBe("ACCEPTED");
    expect(deps.webhooks.record).toHaveBeenCalledWith(studioId, event);
  });
});
