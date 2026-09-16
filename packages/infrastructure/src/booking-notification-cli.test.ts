import { describe, expect, it, vi } from "vitest";

import { ConversationProviderUnavailableError } from "@inkendar/application";
import {
  SMTP_CONNECTIONS_ENVIRONMENT_VARIABLE,
  createChatwootNotificationProviderFactory,
  parseBookingNotificationSchedulerCommand,
} from "./booking-notification-cli.js";

const connection = JSON.stringify([{
  connectionId: "synthetic-connection",
  studioId: "20000000-0000-4000-8000-000000000001",
  baseUrl: "https://chat.example.test",
  accountId: "3",
  apiAccessToken: "synthetic-access-token",
  webhookSecret: "synthetic-webhook-secret",
}]);

describe("booking notification scheduler CLI", () => {
  it("uses one explicit server-only environment variable for per-studio SMTP configuration", () => {
    expect(SMTP_CONNECTIONS_ENVIRONMENT_VARIABLE).toBe("INKENDAR_SMTP_CONNECTIONS_JSON");
  });

  it("uses portable bounded defaults and explicit numeric overrides", () => {
    expect(parseBookingNotificationSchedulerCommand([])).toEqual({ batchSize: 25, leaseSeconds: 60, timeBudgetMs: 20_000 });
    expect(parseBookingNotificationSchedulerCommand(["--batch-size", "10", "--lease-seconds", "30", "--time-budget-ms", "5000"])).toEqual({ batchSize: 10, leaseSeconds: 30, timeBudgetMs: 5_000 });
  });

  it.each([
    ["--batch-size", "0"],
    ["--batch-size", "101"],
    ["--lease-seconds", "9"],
    ["--time-budget-ms", "30001"],
    ["--unknown", "1"],
    ["--batch-size", "10", "--batch-size", "11"],
  ])("rejects invalid or unbounded arguments %#", (...args) => {
    expect(() => parseBookingNotificationSchedulerCommand(args)).toThrowError(expect.objectContaining({ code: "INVALID_BOOKING_NOTIFICATION_INPUT" }));
  });

  it("fails closed before HTTP when the claimed account is not the configured tenant route", () => {
    const fetcher = vi.fn();
    const providerFor = createChatwootNotificationProviderFactory(connection, fetcher);
    expect(() => providerFor({ studioId: "20000000-0000-4000-8000-000000000001", externalAccountId: "4", externalConversationId: "42" })).toThrow(ConversationProviderUnavailableError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("builds the existing Chatwoot adapter only for the exact studio and account", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 84, account_id: 3, conversation_id: 42 }), { status: 200, headers: { "content-type": "application/json" } }));
    const providerFor = createChatwootNotificationProviderFactory(connection, fetcher);
    const provider = providerFor({ studioId: "20000000-0000-4000-8000-000000000001", externalAccountId: "3", externalConversationId: "42" });
    await expect(provider.sendReply("42", "Mensaje genérico")).resolves.toEqual({ externalMessageId: "84" });
    expect(fetcher).toHaveBeenCalledWith("https://chat.example.test/api/v1/accounts/3/conversations/42/messages", expect.objectContaining({ method: "POST" }));
  });
});
