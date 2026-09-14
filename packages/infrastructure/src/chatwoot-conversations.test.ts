import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ConversationProviderUnavailableError, InvalidConversationWebhookError } from "@inkendar/application";
import {
  ChatwootConversationAdapter,
  ChatwootConnections,
  verifyChatwootWebhook,
} from "./chatwoot-conversations.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const connection = {
  connectionId: "north-connection-2026",
  studioId,
  baseUrl: "https://chat.example.test",
  accountId: "3",
  apiAccessToken: "synthetic-api-token",
  webhookSecret: "synthetic-webhook-secret",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("Chatwoot conversation adapter", () => {
  it("loads a validated server-only connection by studio and opaque webhook id", () => {
    const registry = new ChatwootConnections(JSON.stringify([connection]));
    expect(registry.forStudio(studioId)).toEqual(connection);
    expect(registry.forWebhook("north-connection-2026")).toEqual(connection);
    expect(() => registry.forWebhook("unknown")).toThrow(ConversationProviderUnavailableError);
  });

  it("lists and normalizes the first page without returning the provider payload", async () => {
    const request = vi.fn(async () => json({ data: { payload: [{
      id: 42, inbox_id: 7, status: "open", can_reply: true, unread_count: 2, last_activity_at: 1_757_841_600,
      meta: { channel: "Channel::Instagram", sender: { name: "Synthetic client" } },
    }] } }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    await expect(adapter.listConversations()).resolves.toEqual([{
      id: "42", inboxId: "7", status: "open", channel: "instagram", contactName: "Synthetic client",
      unreadCount: 2, lastActivityAt: "2025-09-14T09:20:00.000Z", canReply: true,
    }]);
    expect(request).toHaveBeenCalledWith(
      "https://chat.example.test/api/v1/accounts/3/conversations?status=all&page=1",
      { headers: { api_access_token: "synthetic-api-token" } },
    );
  });

  it("returns only public incoming/outgoing text messages in chronological order", async () => {
    const request = vi.fn(async () => json({ id: 42, inbox_id: 7, can_reply: true, messages: [
      { id: 3, content: "Respuesta", message_type: 1, content_type: "text", private: false, created_at: 30 },
      { id: 1, content: "Nota", message_type: 1, content_type: "text", private: true, created_at: 10 },
      { id: 4, content: "Actividad", message_type: 2, content_type: "text", private: false, created_at: 40 },
      { id: 2, content: "Hola", message_type: 0, content_type: "text", private: false, created_at: 20 },
      { id: 5, content: "Archivo", message_type: 0, content_type: "image", private: false, created_at: 50 },
    ] }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    const thread = await adapter.getConversation("42");
    expect(thread.messages.map((message) => [message.id, message.direction, message.content])).toEqual([
      ["2", "incoming", "Hola"], ["3", "outgoing", "Respuesta"],
    ]);
  });

  it("sends one public outgoing text message and does not retry an ambiguous failure", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => json({ id: 84, conversation_id: 42 }));
    const adapter = new ChatwootConversationAdapter(connection, request);
    await adapter.sendReply("42", "Hola");
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ content: "Hola", message_type: "outgoing", private: false, content_type: "text" });

    request.mockRejectedValueOnce(new TypeError("token synthetic-api-token"));
    const error = await adapter.sendReply("42", "No repetir").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConversationProviderUnavailableError);
    expect(String(error)).not.toContain("synthetic-api-token");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("Chatwoot webhook verifier", () => {
  it("authenticates the raw body and normalizes a recent message_created event", () => {
    const body = JSON.stringify({ event: "message_created", id: 84, created_at: 1_757_841_600, account: { id: 3 }, inbox: { id: 7 }, conversation: { id: 42 } });
    const timestamp = "1757841600";
    const signature = `sha256=${createHmac("sha256", connection.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;

    expect(verifyChatwootWebhook({ connection, rawBody: body, headers: new Headers({
      "X-Chatwoot-Signature": signature, "X-Chatwoot-Timestamp": timestamp, "X-Chatwoot-Delivery": "delivery-1",
    }), now: new Date("2025-09-14T09:22:00.000Z") })).toEqual({
      deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42",
      externalMessageId: "84", occurredAt: "2025-09-14T09:20:00.000Z",
    });
  });

  it.each([
    { name: "bad signature", signature: "sha256=" + "0".repeat(64), timestamp: "1757841600", delivery: "delivery-1" },
    { name: "stale timestamp", signature: "valid", timestamp: "1757841000", delivery: "delivery-1" },
    { name: "missing delivery", signature: "valid", timestamp: "1757841600", delivery: "" },
  ])("fails closed for $name", ({ signature, timestamp, delivery }) => {
    const body = JSON.stringify({ event: "message_created", id: 84, created_at: 1_757_841_600, account: { id: 3 }, inbox: { id: 7 }, conversation: { id: 42 } });
    const signed = `sha256=${createHmac("sha256", connection.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;
    expect(() => verifyChatwootWebhook({ connection, rawBody: body, headers: new Headers({
      "X-Chatwoot-Signature": signature === "valid" ? signed : signature, "X-Chatwoot-Timestamp": timestamp, "X-Chatwoot-Delivery": delivery,
    }), now: new Date("2025-09-14T09:22:00.000Z") })).toThrow(InvalidConversationWebhookError);
  });
});
