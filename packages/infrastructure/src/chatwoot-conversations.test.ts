import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationNotFoundError,
  ConversationProviderRejectedError,
  ConversationProviderUnavailableError,
  InvalidConversationWebhookError,
} from "@inkendar/application";
import {
  ChatwootConversationAdapter,
  ChatwootConnections,
  verifyChatwootWebhook,
} from "./chatwoot-conversations.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const otherStudioId = "20000000-0000-4000-8000-000000000002";
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
  it("normalizes public incoming image attachments without exposing their provider URL", async () => {
    const messages = [
      {
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: "Mira esto", message_type: 0,
        content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6", file_size: 68, width: 1, height: 1 }],
      },
      {
        id: 85, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0,
        content_type: "text", private: false, created_at: 85,
        attachments: [{ id: 7, message_id: 85, account_id: 3, file_type: "image", content_type: "image/jpeg", data_url: "https://chat.example.test/files/7", file_size: 128, width: 2, height: 3 }],
      },
      {
        id: 86, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0,
        content_type: "text", private: false, created_at: 86,
        attachments: [{ id: 8, message_id: 86, account_id: 3, file_type: "file", content_type: "application/pdf", data_url: "https://chat.example.test/files/8", file_size: 128 }],
      },
      {
        id: 87, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0,
        content_type: "text", private: false, created_at: 87,
        attachments: [{ id: 9, message_id: 87, account_id: 3, file_type: "image", content_type: "image/png", data_url: "http://169.254.169.254/latest/meta-data", file_size: 68 }],
      },
      {
        id: 88, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0,
        content_type: "text", private: true, created_at: 88,
        attachments: [{ id: 10, message_id: 88, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/10", file_size: 68 }],
      },
    ];
    const request = vi.fn(async (url: string) => url.endsWith("/messages")
      ? json({ payload: messages })
      : json({ id: 42, account_id: 3, inbox_id: 7, can_reply: true, messages: [] }));

    const thread = await new ChatwootConversationAdapter(connection, request).getConversation("42");

    expect(thread.messages).toEqual([
      { id: "84", direction: "incoming", content: "Mira esto", createdAt: "1970-01-01T00:01:24.000Z", attachments: [{ id: "6", kind: "image" }] },
      { id: "85", direction: "incoming", content: "", createdAt: "1970-01-01T00:01:25.000Z", attachments: [{ id: "7", kind: "image" }] },
      { id: "86", direction: "incoming", content: "", createdAt: "1970-01-01T00:01:26.000Z", attachments: [{ kind: "unsupported" }] },
      { id: "87", direction: "incoming", content: "", createdAt: "1970-01-01T00:01:27.000Z", attachments: [{ kind: "unsupported" }] },
    ]);
    expect(JSON.stringify(thread)).not.toContain("chat.example.test");
    expect(JSON.stringify(thread)).not.toContain("169.254.169.254");
  });

  it("downloads a referenced image server-side and validates its real bytes", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith("/messages?before=85")) return json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6", file_size: png.byteLength, width: 1, height: 1 }],
      }] });
      return new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": String(png.byteLength) } });
    });

    const image = await new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6");

    expect(image).toEqual({ bytes: png, mediaType: "image/png", width: 1, height: 1 });
    expect(request.mock.calls[1]?.[0]).toBe("https://chat.example.test/files/6");
    expect(request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
    expect(request.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });

  it.each([
    { mediaType: "image/jpeg", encoded: "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z" },
    { mediaType: "image/webp", encoded: "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/8gP+QH/ID/+PIAAAA=" },
  ] as const)("serves real $mediaType bytes when allowed", async ({ mediaType, encoded }) => {
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, file_type: "image", content_type: mediaType, data_url: "https://chat.example.test/files/6" }],
      }] })
      : new Response(bytes, { headers: { "Content-Type": mediaType } }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .resolves.toEqual({ bytes, mediaType, width: 2, height: 2 });
  });

  it.each([
    { name: "HTML disguised as PNG", headers: { "Content-Type": "image/png" }, body: new TextEncoder().encode("<html>unsafe</html>") },
    { name: "unsupported GIF", headers: { "Content-Type": "image/gif" }, body: new TextEncoder().encode("GIF89a") },
    { name: "oversized response", headers: { "Content-Type": "image/png", "Content-Length": String(10 * 1024 * 1024 + 1) }, body: new Uint8Array() },
  ])("rejects $name when proxying an advertised image", async ({ headers, body }) => {
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6", file_size: 64, width: 1, height: 1 }],
      }] })
      : new Response(body, { headers }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("blocks redirects outside the configured attachment origins", async () => {
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6", file_size: 64, width: 1, height: 1 }],
      }] })
      : new Response(null, { status: 302, headers: { Location: "https://169.254.169.254/internal" } }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("follows an explicitly configured HTTPS image origin without forwarding the API token", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith("/messages?before=85")) return json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }],
      }] });
      if (url === "https://chat.example.test/files/6") return new Response(null, { status: 302, headers: { Location: "https://cdn.example.test/signed/6" } });
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    });
    const adapter = new ChatwootConversationAdapter({ ...connection, attachmentOrigins: ["https://cdn.example.test"] }, request);

    await expect(adapter.getImageAttachment("42", "84", "6")).resolves.toMatchObject({ mediaType: "image/png", width: 1, height: 1 });
    expect(request.mock.calls[2]?.[0]).toBe("https://cdn.example.test/signed/6");
    expect(request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ redirect: "manual", credentials: "omit" }));
    expect(request.mock.calls[2]?.[1]?.headers).toBeUndefined();
  });

  it.each([
    { name: "another account", row: { account_id: 4 } },
    { name: "another conversation", row: { conversation_id: 43 } },
    { name: "a private note", row: { private: true } },
    { name: "an outgoing image", row: { message_type: 1 } },
    { name: "a foreign attachment", row: { attachments: [{ id: 6, message_id: 99, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }] } },
  ])("never fetches $name", async ({ row }) => {
    const request = vi.fn(async () => json({ payload: [{
      id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
      attachments: [{ id: 6, message_id: 84, account_id: 3, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }],
      ...row,
    }] }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects an image whose actual dimensions exceed the limit", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    new DataView(png.buffer).setUint32(16, 8_193);
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }],
      }] })
      : new Response(png, { headers: { "Content-Type": "image/png" } }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("rejects a truncated PNG that has dimensions but no complete image", async () => {
    const pngHeader = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC", "base64"));
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }],
      }] })
      : new Response(pngHeader, { headers: { "Content-Type": "image/png" } }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("rejects an oversized streamed body even without Content-Length", async () => {
    const request = vi.fn(async (url: string) => url.endsWith("/messages?before=85")
      ? json({ payload: [{
        id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: null, message_type: 0, content_type: "text", private: false, created_at: 84,
        attachments: [{ id: 6, file_type: "image", content_type: "image/png", data_url: "https://chat.example.test/files/6" }],
      }] })
      : new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/png" } }));

    await expect(new ChatwootConversationAdapter(connection, request).getImageAttachment("42", "84", "6"))
      .rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("represents missing owner configuration as no connection", () => {
    expect(new ChatwootConnections(undefined).forStudio(studioId)).toBeNull();
    expect(new ChatwootConnections("[]").forStudio(studioId)).toBeNull();
  });

  it("loads a validated server-only connection by studio and opaque webhook id", () => {
    const registry = new ChatwootConnections(JSON.stringify([connection]));
    expect(registry.forStudio(studioId)).toEqual(connection);
    expect(registry.forWebhook("north-connection-2026")).toEqual(connection);
    expect(() => registry.forWebhook("unknown")).toThrow(ConversationProviderUnavailableError);
  });

  it("rejects assigning one provider account to more than one studio", () => {
    expect(() => new ChatwootConnections(JSON.stringify([
      connection,
      { ...connection, connectionId: "south-connection-2026", studioId: otherStudioId },
    ]))).toThrow(ConversationProviderUnavailableError);
  });

  it("requires explicit public HTTPS attachment origins in server configuration", () => {
    const trusted = new ChatwootConnections(JSON.stringify([{ ...connection, attachmentOrigins: ["https://cdn.example.test"] }]));
    expect(trusted.forStudio(studioId)?.attachmentOrigins).toEqual(["https://cdn.example.test"]);
    for (const origin of ["http://cdn.example.test", "https://127.0.0.1", "https://localhost", "https://cdn.example.test/path", "https://user@cdn.example.test"]) {
      expect(() => new ChatwootConnections(JSON.stringify([{ ...connection, attachmentOrigins: [origin] }]))).toThrow(ConversationProviderUnavailableError);
    }
  });

  it("lists and normalizes a bounded page and its all_count metadata", async () => {
    const request = vi.fn(async () => json({ data: { payload: [{
      id: 42, account_id: 3, inbox_id: 7, status: "open", can_reply: true, unread_count: 2, last_activity_at: 1_757_841_600,
      meta: { channel: "Channel::Instagram", sender: { name: "Synthetic client" } },
    }], meta: { all_count: 26 } } }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    await expect(adapter.listConversations(2)).resolves.toEqual({
      items: [{ id: "42", inboxId: "7", status: "open", channel: "instagram", contactName: "Synthetic client",
        unreadCount: 2, lastActivityAt: "2025-09-14T09:20:00.000Z", canReply: true }],
      totalCount: 26,
    });
    expect(request).toHaveBeenCalledWith(
      "https://chat.example.test/api/v1/accounts/3/conversations?status=all&page=2",
      expect.objectContaining({ headers: { api_access_token: "synthetic-api-token" }, signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects a conversation summary attributed to another account", async () => {
    const request = vi.fn(async () => json({ data: { payload: [{
      id: 42, account_id: 4, inbox_id: 7, status: "open", can_reply: true, unread_count: 2, last_activity_at: 1_757_841_600,
      meta: { channel: "Channel::Instagram", sender: { name: "Synthetic client" } },
    }], meta: { all_count: 1 } } }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    await expect(adapter.listConversations(1)).rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("loads the initial 20-message batch from the messages endpoint", async () => {
    const detailMessages = Array.from({ length: 21 }, (_, index) => ({ id: index + 1 }));
    const batch = [{ id: 84, account_id: 3, inbox_id: 7, conversation_id: 42, content: "Latest", message_type: 0, content_type: "text", private: false, created_at: 84 }];
    const request = vi.fn(async (url: string) => url.endsWith("/messages")
      ? json({ payload: batch })
      : json({ id: 42, account_id: 3, inbox_id: 7, can_reply: true, messages: detailMessages }));
    const thread = await new ChatwootConversationAdapter(connection, request).getConversation("42");
    expect(thread.messages.map((message) => message.id)).toEqual(["84"]);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://chat.example.test/api/v1/accounts/3/conversations/42",
      "https://chat.example.test/api/v1/accounts/3/conversations/42/messages",
    ]);
  });

  it("returns only public incoming/outgoing text messages in chronological order", async () => {
    const messages = [
      { id: 3, account_id: 3, inbox_id: 7, conversation_id: 42, content: "Respuesta", message_type: 1, content_type: "text", private: false, created_at: 30 },
      { id: 1, content: "Nota", message_type: 1, content_type: "text", private: true, created_at: 10 },
      { id: 4, content: "Actividad", message_type: 2, content_type: "text", private: false, created_at: 40 },
      { id: 2, account_id: 3, inbox_id: 7, conversation_id: 42, content: "Hola", message_type: 0, content_type: "text", private: false, created_at: 20 },
      { id: 5, content: "Archivo", message_type: 0, content_type: "image", private: false, created_at: 50 },
    ];
    const request = vi.fn(async (url: string) => url.endsWith("/messages")
      ? json({ payload: messages })
      : json({ id: 42, account_id: 3, inbox_id: 7, can_reply: true, messages: [] }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    const thread = await adapter.getConversation("42");
    expect(thread.messages.map((message) => [message.id, message.direction, message.content])).toEqual([
      ["2", "incoming", "Hola"], ["3", "outgoing", "Respuesta"],
    ]);
  });

  it("loads at most 20 older messages with one positive before cursor", async () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, account_id: 3, inbox_id: 7, conversation_id: 42, content: `Message ${index + 1}`, message_type: 0, content_type: "text", private: false, created_at: index + 1 }));
    const request = vi.fn(async (url: string) => url.endsWith("?before=21")
      ? json({ payload: messages })
      : json({ id: 42, account_id: 3, inbox_id: 7, can_reply: true, messages: [] }));
    const thread = await new ChatwootConversationAdapter(connection, request).getConversation("42", "21");
    expect(thread.before).toBe("1");
    expect(thread.messages).toHaveLength(20);
    expect(request.mock.calls[1]?.[0]).toContain("/messages?before=21");
  });

  it("rejects inconsistent conversation and public-message ownership", async () => {
    const request = vi.fn(async () => json({ id: 43, account_id: 3, inbox_id: 7, can_reply: true, messages: [] }));
    const adapter = new ChatwootConversationAdapter(connection, request);
    await expect(adapter.getConversation("42")).rejects.toBeInstanceOf(ConversationProviderUnavailableError);

    request.mockResolvedValueOnce(json({ id: 42, account_id: 3, inbox_id: 7, can_reply: true, messages: [] }));
    request.mockResolvedValueOnce(json({ payload: [
      { id: 2, account_id: 3, inbox_id: 7, conversation_id: 43, content: "Wrong thread", message_type: 0, content_type: "text", private: false, created_at: 20 },
    ] }));
    await expect(adapter.getConversation("42")).rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it("sends one public outgoing text message and does not retry an ambiguous failure", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => json({ id: 84, account_id: 3, conversation_id: 42 }));
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

  it("rejects a successful-looking reply attributed to another account", async () => {
    const request = vi.fn(async () => json({ id: 84, account_id: 4, conversation_id: 42 }));
    const adapter = new ChatwootConversationAdapter(connection, request);

    await expect(adapter.sendReply("42", "Hola")).rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });

  it.each([
    { name: "empty 404", response: new Response(null, { status: 404 }), error: ConversationNotFoundError },
    { name: "non-JSON 422", response: new Response("unprocessable", { status: 422 }), error: ConversationProviderRejectedError },
  ])("classifies a confirmed $name reply before parsing its body", async ({ response, error }) => {
    const request = vi.fn(async () => response);
    const adapter = new ChatwootConversationAdapter(connection, request);

    await expect(adapter.sendReply("42", "Hola")).rejects.toBeInstanceOf(error);
  });

  it("keeps a malformed successful reply ambiguous", async () => {
    const adapter = new ChatwootConversationAdapter(connection, async () => new Response("not-json", { status: 200 }));

    await expect(adapter.sendReply("42", "Hola")).rejects.toBeInstanceOf(ConversationProviderUnavailableError);
  });
});

describe("Chatwoot webhook verifier", () => {
  it("authenticates the raw body and normalizes a recent message_created event", () => {
    const body = JSON.stringify({ event: "message_created", id: 84, created_at: 1_757_841_600, account: { id: 3 }, inbox: { id: 7 }, conversation: { id: 42, account_id: 3, inbox_id: 7 } });
    const timestamp = "1757841600";
    const signature = `sha256=${createHmac("sha256", connection.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;

    expect(verifyChatwootWebhook({ connection, rawBody: body, headers: new Headers({
      "X-Chatwoot-Signature": signature, "X-Chatwoot-Timestamp": timestamp, "X-Chatwoot-Delivery": "delivery-1",
    }), now: new Date("2025-09-14T09:22:00.000Z") })).toEqual({
      deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42",
      externalMessageId: "84", occurredAt: "2025-09-14T09:20:00.000Z",
    });
  });

  it("rejects inconsistent account and inbox identifiers inside a signed event", () => {
    const body = JSON.stringify({ event: "message_created", id: 84, created_at: 1_757_841_600, account: { id: 3 }, inbox: { id: 7 }, conversation: { id: 42, account_id: 4, inbox_id: 8 } });
    const timestamp = "1757841600";
    const signature = `sha256=${createHmac("sha256", connection.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;

    expect(() => verifyChatwootWebhook({ connection, rawBody: body, headers: new Headers({
      "X-Chatwoot-Signature": signature, "X-Chatwoot-Timestamp": timestamp, "X-Chatwoot-Delivery": "delivery-1",
    }), now: new Date("2025-09-14T09:22:00.000Z") })).toThrow(InvalidConversationWebhookError);
  });

  it.each([
    { name: "bad signature", signature: "sha256=" + "0".repeat(64), timestamp: "1757841600", delivery: "delivery-1" },
    { name: "stale timestamp", signature: "valid", timestamp: "1757841000", delivery: "delivery-1" },
    { name: "missing delivery", signature: "valid", timestamp: "1757841600", delivery: "" },
  ])("fails closed for $name", ({ signature, timestamp, delivery }) => {
    const body = JSON.stringify({ event: "message_created", id: 84, created_at: 1_757_841_600, account: { id: 3 }, inbox: { id: 7 }, conversation: { id: 42, account_id: 3, inbox_id: 7 } });
    const signed = `sha256=${createHmac("sha256", connection.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`;
    expect(() => verifyChatwootWebhook({ connection, rawBody: body, headers: new Headers({
      "X-Chatwoot-Signature": signature === "valid" ? signed : signature, "X-Chatwoot-Timestamp": timestamp, "X-Chatwoot-Delivery": delivery,
    }), now: new Date("2025-09-14T09:22:00.000Z") })).toThrow(InvalidConversationWebhookError);
  });
});
