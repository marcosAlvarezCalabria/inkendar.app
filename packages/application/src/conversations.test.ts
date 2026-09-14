import { describe, expect, it, vi } from "vitest";

import {
  ConversationCannotReplyError,
  ConversationCaseCustomerMismatchError,
  ConversationCustomerNotFoundError,
  ReplyAlreadyInProgressError,
  ReplyOutcomeUnknownError,
  ReplyPreviouslyFailedError,
  createConversationsService,
  type ConversationLinksRepositoryPort,
  type ConversationOutboundRepositoryPort,
  type ConversationProviderPort,
  type ConversationWebhookRepositoryPort,
  type CustomerCaseLookupPort,
} from "./conversations.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const caseId = "70000000-0000-4000-8000-000000000001";
const key = "90000000-0000-4000-8000-000000000001";

function dependencies() {
  const provider: ConversationProviderPort = {
    listConversations: vi.fn(async () => ({ items: [{ id: "42", inboxId: "7", status: "open", channel: "instagram", contactName: "Synthetic client", unreadCount: 2, lastActivityAt: "2026-09-14T10:00:00.000Z", canReply: true } as const], totalCount: 26 })),
    getConversation: vi.fn(async () => ({ id: "42", inboxId: "7", canReply: true, messages: [{ id: "84", direction: "incoming", content: "Hola", createdAt: "2026-09-14T10:00:00.000Z" }], before: "84" } as const)),
    sendReply: vi.fn(async () => ({ externalMessageId: "85" })),
  };
  const links: ConversationLinksRepositoryPort = {
    listLinks: vi.fn(async () => [{ id: "80000000-0000-4000-8000-000000000001", studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: caseId, lastExternalMessageId: null, lastActivityAt: null }]),
    saveLink: vi.fn(async (input) => ({ id: "80000000-0000-4000-8000-000000000001", lastExternalMessageId: null, lastActivityAt: null, ...input })),
  };
  const outbound: ConversationOutboundRepositoryPort = {
    claim: vi.fn(async () => ({ kind: "CLAIMED" as const, operationId: "91000000-0000-4000-8000-000000000001" })),
    markSucceeded: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    markUnknown: vi.fn(async () => undefined),
  };
  const customerCases: CustomerCaseLookupPort = {
    findCustomer: vi.fn(async () => ({ id: customerId, studioId })),
    findTattooCase: vi.fn(async () => ({ id: caseId, studioId, customerId })),
  };
  const webhooks: ConversationWebhookRepositoryPort = { record: vi.fn(async () => "ACCEPTED" as const) };
  return { provider, links, outbound, customerCases, webhooks };
}

describe("conversations service", () => {
  it("joins links into one bounded provider page", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.listInbox(studioId, 1)).resolves.toEqual(expect.objectContaining({
      page: 1, pageSize: 25, totalCount: 26, previousPage: null, nextPage: 2,
      items: [expect.objectContaining({ id: "42", link: expect.objectContaining({ customerId }) })],
    }));
    expect(deps.provider.listConversations).toHaveBeenCalledWith(1, undefined);
  });

  it("passes an opaque older-message cursor", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await service.getThread("42", "84");
    expect(deps.provider.getConversation).toHaveBeenCalledWith("42", "84", undefined);
  });

  it("claims, sends and confirms one normalized reply", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.reply(studioId, " 042 ", "  Hola\r\nMaría  ", key)).resolves.toEqual({ externalMessageId: "85", repeated: false });
    expect(deps.outbound.claim).toHaveBeenCalledWith(studioId, "3", "42", key);
    expect(deps.provider.sendReply).toHaveBeenCalledWith("42", "Hola\nMaría", undefined);
    expect(deps.outbound.markSucceeded).toHaveBeenCalledWith(studioId, "91000000-0000-4000-8000-000000000001", "85");
  });

  it.each([
    ["SUCCEEDED", { kind: "SUCCEEDED" as const, externalMessageId: "85" }, null],
    ["PENDING", { kind: "PENDING" as const }, ReplyAlreadyInProgressError],
    ["FAILED", { kind: "FAILED" as const }, ReplyPreviouslyFailedError],
    ["UNKNOWN", { kind: "UNKNOWN" as const }, ReplyOutcomeUnknownError],
  ])("does not call the provider for an existing %s key", async (_label, claim, expectedError) => {
    const deps = dependencies();
    vi.mocked(deps.outbound.claim).mockResolvedValueOnce(claim);
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    const result = service.reply(studioId, "42", "Hola", key);
    if (expectedError) await expect(result).rejects.toBeInstanceOf(expectedError);
    else await expect(result).resolves.toEqual({ externalMessageId: "85", repeated: true });
    expect(deps.provider.getConversation).not.toHaveBeenCalled();
    expect(deps.provider.sendReply).not.toHaveBeenCalled();
  });

  it("marks a non-replyable newly claimed operation FAILED", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.getConversation).mockResolvedValueOnce({ id: "42", inboxId: "7", canReply: false, messages: [], before: null });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.reply(studioId, "42", "Hola", key)).rejects.toBeInstanceOf(ConversationCannotReplyError);
    expect(deps.outbound.markFailed).toHaveBeenCalledOnce();
    expect(deps.provider.sendReply).not.toHaveBeenCalled();
  });

  it("marks an ambiguous provider outcome UNKNOWN", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.sendReply).mockRejectedValueOnce(new Error("network"));
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.reply(studioId, "42", "Hola", key)).rejects.toBeInstanceOf(ReplyOutcomeUnknownError);
    expect(deps.outbound.markUnknown).toHaveBeenCalledOnce();
  });

  it("creates a customer/case link after tenant checks", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await service.link(studioId, { conversationId: "42", customerId, tattooCaseId: caseId });
    expect(deps.links.saveLink).toHaveBeenCalledWith({ studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: caseId });
  });

  it("rejects a case belonging to another customer before persistence", async () => {
    const deps = dependencies();
    vi.mocked(deps.customerCases.findTattooCase).mockResolvedValueOnce({ id: caseId, studioId, customerId: "60000000-0000-4000-8000-000000000002" });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.link(studioId, { conversationId: "42", customerId, tattooCaseId: caseId })).rejects.toBeInstanceOf(ConversationCaseCustomerMismatchError);
    expect(deps.links.saveLink).not.toHaveBeenCalled();
  });

  it("rejects lookup results outside the authorized tenant", async () => {
    const deps = dependencies();
    vi.mocked(deps.customerCases.findCustomer).mockResolvedValueOnce({ id: customerId, studioId: "20000000-0000-4000-8000-000000000002" });
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    await expect(service.link(studioId, { conversationId: "42", customerId })).rejects.toBeInstanceOf(ConversationCustomerNotFoundError);
    expect(deps.provider.getConversation).not.toHaveBeenCalled();
  });

  it("delegates webhook receipts to the canonical atomic port", async () => {
    const deps = dependencies();
    const service = createConversationsService({ ...deps, externalAccountId: "3" });
    const event = { deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", externalMessageId: "84", occurredAt: "2026-09-14T10:00:00.000Z" } as const;
    await expect(service.ingest(studioId, event)).resolves.toBe("ACCEPTED");
    expect(deps.webhooks.record).toHaveBeenCalledWith(studioId, event);
  });
});
