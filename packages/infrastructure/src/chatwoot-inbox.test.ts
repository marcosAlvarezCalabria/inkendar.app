import { describe, expect, it, vi } from "vitest";

import { MessagingProviderOutcomeUnknownError, MessagingProviderUnavailableError } from "@inkendar/application";
import { ChatwootInboxAdapter, EnvironmentCredentialResolver, loadMessagingProviderConfig } from "./chatwoot-inbox.js";

const connection = { id: "80000000-0000-4000-8000-000000000001", studioId: "20000000-0000-4000-8000-000000000001", externalAccountId: "7", credentialReference: "studio-north" };
const resolver = { resolve: vi.fn(async () => "secret-token") };

describe("Chatwoot inbox HTTP adapter", () => {
  it("lists open conversations through the documented account endpoint", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ data: { meta: { all_count: 26 }, payload: [{ id: 42, status: "open", last_activity_at: 1700000000, unread_count: 2, meta: { sender: { name: "Consulta web" } }, last_non_activity_message: { content: "Hola" } }] } }));
    const result = await new ChatwootInboxAdapter("https://messages.example", resolver, fetcher).listOpenConversations(connection, 2);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://messages.example/api/v1/accounts/7/conversations?status=open&page=2");
    expect((init as RequestInit).headers).toEqual({ Accept: "application/json", api_access_token: "secret-token" });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ items: [{ id: "42", title: "Consulta web", lastMessagePreview: "Hola", lastActivityAt: 1700000000, unreadCount: 2 }], totalCount: 26 });
  });

  it("reads messages and maps only documented text fields", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ payload: [
      { id: 4, content: "Hola", conversation_id: 42, message_type: 0, content_type: "text", created_at: 1700000000, private: false },
      { id: 5, content: "Respuesta", conversation_id: 42, message_type: 1, content_type: "text", created_at: 1700000001, private: false },
      { id: 6, content: "Nota", conversation_id: 42, message_type: 1, content_type: "text", created_at: 1700000002, private: true },
    ] }));
    const result = await new ChatwootInboxAdapter("https://messages.example", resolver, fetcher).getMessages(connection, "42");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://messages.example/api/v1/accounts/7/conversations/42/messages");
    expect(result).toEqual({ items: [
      { id: "4", content: "Hola", direction: "INCOMING", createdAt: 1700000000 },
      { id: "5", content: "Respuesta", direction: "OUTGOING", createdAt: 1700000001 },
    ], before: null });
  });

  it("loads older messages with one opaque before cursor and stops repeated-cursor loops", async () => {
    const payload = Array.from({ length: 20 }, (_, index) => ({ id: 100 + index, content: `Mensaje ${index}`, conversation_id: 42, message_type: 0, content_type: "text", created_at: 1700000000 + index, private: false }));
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ payload }));
    const subject = new ChatwootInboxAdapter("https://messages.example", resolver, fetcher);
    const page = await subject.getMessages(connection, "42", "120");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://messages.example/api/v1/accounts/7/conversations/42/messages?before=120");
    expect(page.items).toHaveLength(20);
    expect(page.before).toBe("100");
    const repeated = await subject.getMessages(connection, "42", "100");
    expect(repeated.before).toBeNull();
  });

  it("creates the documented public outgoing text message without invented idempotency fields", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ id: 99, content: "Hola", account_id: 7, conversation_id: 42, message_type: 1, created_at: 1700000002, private: false, content_type: "text" }));
    const result = await new ChatwootInboxAdapter("https://messages.example", resolver, fetcher).sendReply(connection, "42", "Hola");
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://messages.example/api/v1/accounts/7/conversations/42/messages");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ content: "Hola", message_type: "outgoing", private: false, content_type: "text" }) });
    expect(result).toEqual({ externalMessageId: "99" });
  });

  it("sanitizes invalid and failed upstream responses", async () => {
    const invalid = new ChatwootInboxAdapter("https://messages.example", resolver, vi.fn(async () => Response.json({ data: { payload: [{ id: "bad", meta: { sender: { name: "Private Name" } } }] } })));
    await expect(invalid.listOpenConversations(connection)).rejects.toEqual(expect.objectContaining({ code: "MESSAGING_PROVIDER_UNAVAILABLE", message: "Messaging provider unavailable" }));

    const failed = new ChatwootInboxAdapter("https://messages.example", resolver, vi.fn(async () => new Response("token=secret-token Private Name", { status: 500 })));
    await expect(failed.listOpenConversations(connection)).rejects.toBeInstanceOf(MessagingProviderUnavailableError);
  });

  it("treats a network failure while sending as an unknown outcome", async () => {
    const subject = new ChatwootInboxAdapter("https://messages.example", resolver, vi.fn(async () => { throw new TypeError("secret-token Private content"); }));
    await expect(subject.sendReply(connection, "42", "Private content")).rejects.toBeInstanceOf(MessagingProviderOutcomeUnknownError);
  });

  it.each(["http://messages.example", "https://user:pass@messages.example", "https://messages.example/path", "https://messages.example?x=1", "https://messages.example/#x"])("rejects untrusted provider base URL %s", (baseUrl) => {
    expect(() => loadMessagingProviderConfig({ INKENDAR_MESSAGING_BASE_URL: baseUrl, INKENDAR_MESSAGING_CREDENTIALS_JSON: "{}" })).toThrowError(/configuration/i);
  });

  it("resolves only named server-side credentials from JSON", async () => {
    const credentials = new EnvironmentCredentialResolver('{"studio-north":"secret-token"}');
    await expect(credentials.resolve("studio-north")).resolves.toBe("secret-token");
    await expect(credentials.resolve("unknown")).rejects.toThrowError(/credential/i);
  });
});
