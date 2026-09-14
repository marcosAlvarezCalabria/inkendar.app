import { describe, expect, it, vi } from "vitest";

import { SupabaseConversationsAdapter, SupabaseConversationsAdapterError, type ConversationsDataGateway } from "./supabase-conversations.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";

function gateway(): ConversationsDataGateway {
  return {
    listLinks: vi.fn(async () => ({ data: [], error: null })),
    upsertLink: vi.fn(async () => ({ data: { id: "80000000-0000-4000-8000-000000000001", studio_id: studioId, external_account_id: "3", external_inbox_id: "7", external_conversation_id: "42", customer_id: customerId, tattoo_case_id: null, last_external_message_id: null, last_activity_at: null }, error: null })),
    recordWebhook: vi.fn(async () => ({ data: "ACCEPTED", error: null })),
    claimOutbound: vi.fn(async () => ({ data: [{ claim_status: "CLAIMED", operation_id: "90000000-0000-4000-8000-000000000001", external_message_id: null }], error: null })),
    transitionOutbound: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase conversations adapter", () => {
  it("scopes links to the authorized studio and provider account", async () => {
    const data = gateway();
    const adapter = new SupabaseConversationsAdapter(data);
    await adapter.listLinks(studioId, "3");
    expect(data.listLinks).toHaveBeenCalledWith({ studio_id: studioId, provider: "chatwoot", external_account_id: "3" });
  });

  it("rejects a persistence response outside the requested tenant scope", async () => {
    const data = gateway();
    vi.mocked(data.listLinks).mockResolvedValueOnce({ data: [{
      id: "80000000-0000-4000-8000-000000000001",
      studio_id: "20000000-0000-4000-8000-000000000002",
      external_account_id: "3",
      external_inbox_id: "7",
      external_conversation_id: "42",
      customer_id: customerId,
      tattoo_case_id: null,
      last_external_message_id: null,
      last_activity_at: null,
    }], error: null });
    const adapter = new SupabaseConversationsAdapter(data);

    await expect(adapter.listLinks(studioId, "3")).rejects.toBeInstanceOf(SupabaseConversationsAdapterError);
  });

  it("upserts the agreed tenant-safe relationship with one conflict key", async () => {
    const data = gateway();
    const adapter = new SupabaseConversationsAdapter(data);
    await adapter.saveLink({ studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: null });
    expect(data.upsertLink).toHaveBeenCalledWith({ studio_id: studioId, provider: "chatwoot", external_account_id: "3", external_inbox_id: "7", external_conversation_id: "42", customer_id: customerId, tattoo_case_id: null });
  });

  it("rejects an upsert result for a different provider account", async () => {
    const data = gateway();
    vi.mocked(data.upsertLink).mockResolvedValueOnce({ data: {
      id: "80000000-0000-4000-8000-000000000001",
      studio_id: studioId,
      external_account_id: "4",
      external_inbox_id: "7",
      external_conversation_id: "42",
      customer_id: customerId,
      tattoo_case_id: null,
      last_external_message_id: null,
      last_activity_at: null,
    }, error: null });
    const adapter = new SupabaseConversationsAdapter(data);

    await expect(adapter.saveLink({ studioId, externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", customerId, tattooCaseId: null })).rejects.toBeInstanceOf(SupabaseConversationsAdapterError);
  });

  it("records a normalized webhook through the atomic RPC and exposes duplicate status", async () => {
    const data = gateway();
    vi.mocked(data.recordWebhook).mockResolvedValueOnce({ data: "DUPLICATE", error: null });
    const adapter = new SupabaseConversationsAdapter(data);
    const result = await adapter.record(studioId, { deliveryId: "delivery-1", externalAccountId: "3", externalInboxId: "7", externalConversationId: "42", externalMessageId: "84", occurredAt: "2025-09-14T10:00:00.000Z" });
    expect(result).toBe("DUPLICATE");
    expect(data.recordWebhook).toHaveBeenCalledWith({ p_studio_id: studioId, p_provider: "chatwoot", p_delivery_id: "delivery-1", p_event_name: "message_created", p_external_account_id: "3", p_external_inbox_id: "7", p_external_conversation_id: "42", p_external_message_id: "84", p_occurred_at: "2025-09-14T10:00:00.000Z" });
  });

  it("claims and transitions outbound operations through opaque canonical RPCs", async () => {
    const data = gateway();
    const adapter = new SupabaseConversationsAdapter(data);
    await expect(adapter.claim(studioId, "3", "42", "91000000-0000-4000-8000-000000000001")).resolves.toEqual({
      kind: "CLAIMED", operationId: "90000000-0000-4000-8000-000000000001",
    });
    expect(data.claimOutbound).toHaveBeenCalledWith({
      p_studio_id: studioId, p_provider: "chatwoot", p_external_account_id: "3",
      p_external_conversation_id: "42", p_idempotency_key: "91000000-0000-4000-8000-000000000001",
    });
    await adapter.markSucceeded(studioId, "90000000-0000-4000-8000-000000000001", "84");
    expect(data.transitionOutbound).toHaveBeenCalledWith({
      p_studio_id: studioId, p_operation_id: "90000000-0000-4000-8000-000000000001",
      p_status: "SUCCEEDED", p_external_message_id: "84",
    });
  });
});
