import { describe, expect, it, vi } from "vitest";

import type { ConversationWebhookObservabilityPort, ConversationWebhookRepositoryPort } from "@inkendar/application";
import { InvalidConversationWebhookError } from "@inkendar/application";
import { createConversationWebhookHandler } from "./conversation-webhook.server.js";

const connection = { connectionId: "north-connection-2026", studioId: "20000000-0000-4000-8000-000000000001", baseUrl: "https://chat.example.test", accountId: "3", apiAccessToken: "synthetic-api-token", webhookSecret: "synthetic-webhook-secret" } as const;
const event = { deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", externalMessageId: "84", occurredAt: "2026-09-14T10:00:00.000Z" } as const;

function observability(): ConversationWebhookObservabilityPort {
  return { recordAttempt: vi.fn(async () => undefined) };
}

describe("conversation webhook handler", () => {
  it("verifies before creating privileged persistence and exposes accepted status", async () => {
    const order: string[] = [];
    const repository: ConversationWebhookRepositoryPort = { record: vi.fn(async () => { order.push("record"); return "ACCEPTED" as const; }) };
    const attempts = observability();
    const handler = createConversationWebhookHandler({
      connection: () => connection,
      verify: () => { order.push("verify"); return event; },
      repository: () => { order.push("repository"); return repository; },
      observability: () => attempts,
    });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(order).toEqual(["verify", "repository", "record"]);
    expect(attempts.recordAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { reason: "AUTH_HEADERS_MISSING", outcome: "auth_headers_missing" },
    { reason: "AUTH_INVALID", outcome: "auth_invalid" },
    { reason: "SIGNATURE_INVALID", outcome: "signature_invalid" },
    { reason: "SCHEMA_INVALID", outcome: "schema_invalid" },
  ] as const)("records sanitized $outcome evidence and fails closed", async ({ reason, outcome }) => {
    const repository = vi.fn();
    const attempts = observability();
    const handler = createConversationWebhookHandler({
      connection: () => connection,
      verify: () => { throw new InvalidConversationWebhookError(reason); },
      repository,
      observability: () => attempts,
    });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(401);
    expect(repository).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("signature");
    expect(attempts.recordAttempt).toHaveBeenCalledWith(connection.studioId, outcome);
  });

  it("returns a successful duplicate acknowledgement for a repeated authenticated delivery", async () => {
    const repository: ConversationWebhookRepositoryPort = { record: vi.fn(async () => "DUPLICATE" as const) };
    const handler = createConversationWebhookHandler({ connection: () => connection, verify: () => event, repository: () => repository, observability });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate" });
  });

  it("rejects an oversized streamed body before verification or privileged persistence", async () => {
    const verify = vi.fn(() => event);
    const repository = vi.fn();
    const attempts = observability();
    const handler = createConversationWebhookHandler({ connection: () => connection, verify, repository, observability: () => attempts });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(262_145),
    }), "north-connection-2026");

    expect(response.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    expect(repository).not.toHaveBeenCalled();
    expect(attempts.recordAttempt).toHaveBeenCalledWith(connection.studioId, "request_invalid");
  });

  it("rejects JSON-like media types that are not application/json", async () => {
    const verify = vi.fn(() => event);
    const attempts = observability();
    const resolveConnection = vi.fn(() => connection);
    const handler = createConversationWebhookHandler({ connection: resolveConnection, verify, repository: vi.fn(), observability: () => attempts });
    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", {
      method: "POST",
      headers: { "Content-Type": "application/jsonp" },
      body: "{}",
    }), "north-connection-2026");

    expect(response.status).toBe(415);
    expect(verify).not.toHaveBeenCalled();
    expect(resolveConnection).not.toHaveBeenCalled();
    expect(attempts.recordAttempt).not.toHaveBeenCalled();
  });

  it("records persistence failure best-effort without replacing the public 503", async () => {
    const attempts = observability();
    vi.mocked(attempts.recordAttempt).mockRejectedValueOnce(new Error("synthetic observability failure"));
    const handler = createConversationWebhookHandler({
      connection: () => connection,
      verify: () => event,
      repository: () => { throw new Error("synthetic receipt failure"); },
      observability: () => attempts,
    });

    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/north-connection-2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "north-connection-2026");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "No se pudo registrar la entrega." });
    expect(attempts.recordAttempt).toHaveBeenCalledWith(connection.studioId, "persistence_failed");
  });

  it("does not persist or reveal whether a connection identifier is unknown", async () => {
    const attempts = vi.fn();
    const handler = createConversationWebhookHandler({
      connection: () => { throw new Error("unknown"); },
      verify: vi.fn(),
      repository: vi.fn(),
      observability: attempts,
    });

    const response = await handler(new Request("https://app.inkendar.es/api/webhooks/chatwoot/attacker-value", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "attacker-value");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Solicitud no autorizada." });
    expect(attempts).not.toHaveBeenCalled();
  });
});
