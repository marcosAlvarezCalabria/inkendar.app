import { describe, expect, it, vi } from "vitest";

import type { ConversationWebhookRepositoryPort } from "@inkendar/application";
import { InvalidConversationWebhookError } from "@inkendar/application";
import { createConversationWebhookHandler } from "./conversation-webhook.server.js";

const connection = { connectionId: "north-connection-2026", studioId: "20000000-0000-4000-8000-000000000001", baseUrl: "https://chat.example.test", accountId: "3", apiAccessToken: "synthetic-api-token", webhookSecret: "synthetic-webhook-secret" } as const;
const event = { deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", externalMessageId: "84", occurredAt: "2026-09-14T10:00:00.000Z" } as const;

describe("conversation webhook handler", () => {
  it("verifies before creating privileged persistence and exposes accepted status", async () => {
    const order: string[] = [];
    const repository: ConversationWebhookRepositoryPort = { record: vi.fn(async () => { order.push("record"); return "ACCEPTED" as const; }) };
    const handler = createConversationWebhookHandler({
      connection: () => connection,
      verify: () => { order.push("verify"); return event; },
      repository: () => { order.push("repository"); return repository; },
    });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(order).toEqual(["verify", "repository", "record"]);
  });

  it("fails closed without creating privileged persistence for invalid authentication", async () => {
    const repository = vi.fn();
    const handler = createConversationWebhookHandler({ connection: () => connection, verify: () => { throw new InvalidConversationWebhookError(); }, repository });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(401);
    expect(repository).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("signature");
  });

  it("returns a successful duplicate acknowledgement for a repeated authenticated delivery", async () => {
    const repository: ConversationWebhookRepositoryPort = { record: vi.fn(async () => "DUPLICATE" as const) };
    const handler = createConversationWebhookHandler({ connection: () => connection, verify: () => event, repository: () => repository });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate" });
  });

  it("rejects an oversized streamed body before verification or privileged persistence", async () => {
    const verify = vi.fn(() => event);
    const repository = vi.fn();
    const handler = createConversationWebhookHandler({ connection: () => connection, verify, repository });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(262_145),
    }), "north-connection-2026");

    expect(response.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    expect(repository).not.toHaveBeenCalled();
  });

  it("rejects JSON-like media types that are not application/json", async () => {
    const verify = vi.fn(() => event);
    const handler = createConversationWebhookHandler({ connection: () => connection, verify, repository: vi.fn() });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", {
      method: "POST",
      headers: { "Content-Type": "application/jsonp" },
      body: "{}",
    }), "north-connection-2026");

    expect(response.status).toBe(415);
    expect(verify).not.toHaveBeenCalled();
  });
});
