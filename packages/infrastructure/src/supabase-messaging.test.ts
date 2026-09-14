import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMessagingAdapter, SupabaseMessagingAdapterError } from "./supabase-messaging.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const connectionId = "80000000-0000-4000-8000-000000000001";
const linkId = "81000000-0000-4000-8000-000000000001";
const operationId = "91000000-0000-4000-8000-000000000001";
const key = "90000000-0000-4000-8000-000000000001";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function query(result: QueryResult) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    upsert: vi.fn(async () => result),
    update: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  return builder;
}

function clientFor(builder: ReturnType<typeof query>, rpcResult: QueryResult = { data: [], error: null }) {
  return {
    from: vi.fn(() => builder),
    rpc: vi.fn(async () => rpcResult),
  } as unknown as SupabaseClient;
}

describe("Supabase messaging adapter", () => {
  it("loads an active connection with an explicit authorized-studio filter", async () => {
    const builder = query({ data: { id: connectionId, studio_id: studioId, external_account_id: 7, credential_reference: "studio-north" }, error: null });
    const client = clientFor(builder);
    await expect(new SupabaseMessagingAdapter(client).findActiveConnection(studioId)).resolves.toEqual({
      id: connectionId, studioId, externalAccountId: "7", credentialReference: "studio-north",
    });
    expect(client.from).toHaveBeenCalledWith("integration_connection");
    expect(builder.eq).toHaveBeenNthCalledWith(1, "studio_id", studioId);
    expect(builder.eq).toHaveBeenNthCalledWith(2, "status", "ACTIVE");
  });

  it("upserts only opaque tenant-scoped conversation links", async () => {
    const builder = query({ data: null, error: null });
    const client = clientFor(builder);
    await new SupabaseMessagingAdapter(client).upsertConversationLinks(studioId, connectionId, ["42", "43"]);
    expect(builder.upsert).toHaveBeenCalledWith([
      { studio_id: studioId, integration_connection_id: connectionId, external_conversation_id: "42" },
      { studio_id: studioId, integration_connection_id: connectionId, external_conversation_id: "43" },
    ], { onConflict: "integration_connection_id,external_conversation_id", ignoreDuplicates: true });
  });

  it.each([
    ["CLAIMED", { kind: "CLAIMED", operationId }],
    ["PENDING", { kind: "PENDING" }],
    ["UNKNOWN", { kind: "UNKNOWN" }],
  ] as const)("maps the %s claim without retrying it", async (claimStatus, expected) => {
    const builder = query({ data: null, error: null });
    const client = clientFor(builder, { data: [{ claim_status: claimStatus, operation_id: operationId, external_message_id: null }], error: null });
    await expect(new SupabaseMessagingAdapter(client).claimOutboundOperation(studioId, linkId, key)).resolves.toEqual(expected);
    expect(client.rpc).toHaveBeenCalledWith("claim_outbound_message_operation", {
      p_studio_id: studioId, p_conversation_link_id: linkId, p_idempotency_key: key,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns the recorded provider id for a successful duplicate", async () => {
    const builder = query({ data: null, error: null });
    const client = clientFor(builder, { data: [{ claim_status: "SUCCEEDED", operation_id: operationId, external_message_id: 99 }], error: null });
    await expect(new SupabaseMessagingAdapter(client).claimOutboundOperation(studioId, linkId, key)).resolves.toEqual({ kind: "SUCCEEDED", externalMessageId: "99" });
  });

  it("marks an operation only while it is pending and in the authorized studio", async () => {
    const builder = query({ data: { id: operationId }, error: null });
    const client = clientFor(builder);
    await new SupabaseMessagingAdapter(client).markOutboundUnknown(studioId, operationId);
    expect(builder.update).toHaveBeenCalledWith({ status: "UNKNOWN" });
    expect(builder.eq).toHaveBeenNthCalledWith(1, "studio_id", studioId);
    expect(builder.eq).toHaveBeenNthCalledWith(2, "id", operationId);
    expect(builder.eq).toHaveBeenNthCalledWith(3, "status", "PENDING");
  });

  it("sanitizes malformed rows and persistence errors", async () => {
    const malformed = query({ data: { id: connectionId, studio_id: studioId, external_account_id: "not-an-id", credential_reference: "studio-north" }, error: null });
    await expect(new SupabaseMessagingAdapter(clientFor(malformed)).findActiveConnection(studioId)).rejects.toBeInstanceOf(SupabaseMessagingAdapterError);

    const hidden = query({ data: null, error: null });
    const failure = new SupabaseMessagingAdapter(clientFor(hidden)).markOutboundSucceeded(studioId, operationId, "99").catch((error: unknown) => error);
    await expect(failure).resolves.toEqual(expect.objectContaining({ code: "SUPABASE_MESSAGING_FAILED", message: "Messaging persistence failed" }));
  });
});
