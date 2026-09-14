import { describe, expect, it, vi } from "vitest";

import {
  ConversationNotFoundError,
  MessagingProviderOutcomeUnknownError,
  MessagingProviderRejectedError,
  ReplyAlreadyInProgressError,
  ReplyOutcomeUnknownError,
  createMessagingService,
  type InboxProviderPort,
  type MessagingRepositoryPort,
} from "./messaging.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const connection = { id: "80000000-0000-4000-8000-000000000001", studioId, externalAccountId: "7", credentialReference: "studio-north" };
const link = { id: "81000000-0000-4000-8000-000000000001", studioId, connectionId: connection.id, externalConversationId: "42" };
const key = "90000000-0000-4000-8000-000000000001";

function repository(): MessagingRepositoryPort {
  return {
    findActiveConnection: vi.fn(async () => connection),
    upsertConversationLinks: vi.fn(async () => undefined),
    findConversationLink: vi.fn(async () => link),
    claimOutboundOperation: vi.fn(async () => ({ kind: "CLAIMED" as const, operationId: "91000000-0000-4000-8000-000000000001" })),
    markOutboundSucceeded: vi.fn(async () => undefined),
    markOutboundFailed: vi.fn(async () => undefined),
    markOutboundUnknown: vi.fn(async () => undefined),
  };
}

function provider(): InboxProviderPort {
  return {
    listOpenConversations: vi.fn(async () => [{ id: "42", title: "Consulta", lastMessagePreview: "Hola", lastActivityAt: 1_700_000_000, unreadCount: 2 }]),
    getMessages: vi.fn(async () => [{ id: "4", content: "Hola", direction: "INCOMING" as const, createdAt: 1_700_000_000 }]),
    sendReply: vi.fn(async () => ({ externalMessageId: "99" })),
  };
}

describe("messaging service", () => {
  it("lists only through the tenant connection and records opaque links", async () => {
    const repo = repository(); const upstream = provider();
    const result = await createMessagingService(repo, upstream).listOpenConversations(studioId);
    expect(result).toHaveLength(1);
    expect(upstream.listOpenConversations).toHaveBeenCalledWith(connection, undefined);
    expect(repo.upsertConversationLinks).toHaveBeenCalledWith(studioId, connection.id, ["42"]);
  });

  it("returns an empty list without resolving credentials when the studio has no connection", async () => {
    const repo = repository(); vi.mocked(repo.findActiveConnection).mockResolvedValue(null); const upstream = provider();
    expect(await createMessagingService(repo, upstream).listOpenConversations(studioId)).toEqual([]);
    expect(upstream.listOpenConversations).not.toHaveBeenCalled();
  });

  it("checks the tenant link before reading provider messages", async () => {
    const repo = repository(); vi.mocked(repo.findConversationLink).mockResolvedValue(null); const upstream = provider();
    await expect(createMessagingService(repo, upstream).getConversationMessages(studioId, "42")).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(upstream.getMessages).not.toHaveBeenCalled();
  });

  it("reads messages through the active connection matching the link", async () => {
    const repo = repository(); const upstream = provider();
    const result = await createMessagingService(repo, upstream).getConversationMessages(studioId, "42");
    expect(result[0]?.direction).toBe("INCOMING");
    expect(upstream.getMessages).toHaveBeenCalledWith(connection, "42", undefined);
  });

  it("validates content before touching persistence or credentials", async () => {
    const repo = repository(); const upstream = provider();
    await expect(createMessagingService(repo, upstream).sendConversationReply(studioId, "42", " ", key)).rejects.toMatchObject({ code: "INVALID_MESSAGING_INPUT" });
    expect(repo.findActiveConnection).not.toHaveBeenCalled();
    expect(upstream.sendReply).not.toHaveBeenCalled();
  });

  it("sends once and stores only the provider identifier", async () => {
    const repo = repository(); const upstream = provider();
    const result = await createMessagingService(repo, upstream).sendConversationReply(studioId, "42", " Hola ", key);
    expect(result).toEqual({ externalMessageId: "99", repeated: false });
    expect(upstream.sendReply).toHaveBeenCalledWith(connection, "42", "Hola", undefined);
    expect(repo.markOutboundSucceeded).toHaveBeenCalledWith(studioId, "91000000-0000-4000-8000-000000000001", "99");
    expect(repo.markOutboundSucceeded).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining("Hola"));
  });

  it("returns a previous success without sending again", async () => {
    const repo = repository(); vi.mocked(repo.claimOutboundOperation).mockResolvedValue({ kind: "SUCCEEDED", externalMessageId: "99" }); const upstream = provider();
    const result = await createMessagingService(repo, upstream).sendConversationReply(studioId, "42", "Hola", key);
    expect(result).toEqual({ externalMessageId: "99", repeated: true });
    expect(upstream.sendReply).not.toHaveBeenCalled();
  });

  it("blocks a duplicate while the first request is in progress", async () => {
    const repo = repository(); vi.mocked(repo.claimOutboundOperation).mockResolvedValue({ kind: "PENDING" }); const upstream = provider();
    await expect(createMessagingService(repo, upstream).sendConversationReply(studioId, "42", "Hola", key)).rejects.toBeInstanceOf(ReplyAlreadyInProgressError);
    expect(upstream.sendReply).not.toHaveBeenCalled();
  });

  it("does not resend an operation with an unknown outcome", async () => {
    const repo = repository(); vi.mocked(repo.claimOutboundOperation).mockResolvedValue({ kind: "UNKNOWN" }); const upstream = provider();
    await expect(createMessagingService(repo, upstream).sendConversationReply(studioId, "42", "Hola", key)).rejects.toBeInstanceOf(ReplyOutcomeUnknownError);
    expect(upstream.sendReply).not.toHaveBeenCalled();
  });

  it("marks a confirmed provider rejection as failed", async () => {
    const repo = repository(); const upstream = provider(); vi.mocked(upstream.sendReply).mockRejectedValue(new MessagingProviderRejectedError());
    await expect(createMessagingService(repo, upstream).sendConversationReply(studioId, "42", "Hola", key)).rejects.toBeInstanceOf(MessagingProviderRejectedError);
    expect(repo.markOutboundFailed).toHaveBeenCalledWith(studioId, "91000000-0000-4000-8000-000000000001");
  });

  it("marks a timeout or ambiguous response unknown and never includes the message", async () => {
    const repo = repository(); const upstream = provider(); vi.mocked(upstream.sendReply).mockRejectedValue(new MessagingProviderOutcomeUnknownError());
    await expect(createMessagingService(repo, upstream).sendConversationReply(studioId, "42", "Private content", key)).rejects.toBeInstanceOf(ReplyOutcomeUnknownError);
    expect(repo.markOutboundUnknown).toHaveBeenCalledWith(studioId, "91000000-0000-4000-8000-000000000001");
  });
});
