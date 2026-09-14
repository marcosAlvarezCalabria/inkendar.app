import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationLink, MessagingConnection, MessagingRepositoryPort, OutboundClaim } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

export class SupabaseMessagingAdapterError extends Error {
  readonly code = "SUPABASE_MESSAGING_FAILED";
  constructor() { super("Messaging persistence failed"); this.name = "SupabaseMessagingAdapterError"; }
}

export class SupabaseMessagingAdapter implements MessagingRepositoryPort {
  constructor(private readonly client: SupabaseClient) {}

  async findActiveConnection(studioId: string): Promise<MessagingConnection | null> {
    const { data, error } = await this.client.from("integration_connection")
      .select("id,studio_id,external_account_id,credential_reference")
      .eq("studio_id", studioId).eq("status", "ACTIVE").maybeSingle();
    if (error) throw new SupabaseMessagingAdapterError();
    if (data === null) return null;
    const row = object(data);
    return { id: string(row.id), studioId: string(row.studio_id), externalAccountId: integerString(row.external_account_id), credentialReference: string(row.credential_reference) };
  }

  async upsertConversationLinks(studioId: string, connectionId: string, externalConversationIds: readonly string[]): Promise<void> {
    if (externalConversationIds.length === 0) return;
    const values = externalConversationIds.map((id) => ({ studio_id: studioId, integration_connection_id: connectionId, external_conversation_id: id }));
    const { error } = await this.client.from("conversation_link").upsert(values, { onConflict: "integration_connection_id,external_conversation_id", ignoreDuplicates: true });
    if (error) throw new SupabaseMessagingAdapterError();
  }

  async findConversationLink(studioId: string, externalConversationId: string): Promise<ConversationLink | null> {
    const { data, error } = await this.client.from("conversation_link").select("id,studio_id,integration_connection_id,external_conversation_id")
      .eq("studio_id", studioId).eq("external_conversation_id", externalConversationId).maybeSingle();
    if (error) throw new SupabaseMessagingAdapterError();
    if (data === null) return null;
    const row = object(data);
    return { id: string(row.id), studioId: string(row.studio_id), connectionId: string(row.integration_connection_id), externalConversationId: integerString(row.external_conversation_id) };
  }

  async claimOutboundOperation(studioId: string, conversationLinkId: string, idempotencyKey: string): Promise<OutboundClaim> {
    const { data, error } = await this.client.rpc("claim_outbound_message_operation", {
      p_studio_id: studioId, p_conversation_link_id: conversationLinkId, p_idempotency_key: idempotencyKey,
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new SupabaseMessagingAdapterError();
    const row = object(data[0]); const status = string(row.claim_status);
    if (status === "CLAIMED") return { kind: "CLAIMED", operationId: string(row.operation_id) };
    if (status === "SUCCEEDED") return { kind: "SUCCEEDED", externalMessageId: integerString(row.external_message_id) };
    if (status === "PENDING" || status === "UNKNOWN") return { kind: status };
    throw new SupabaseMessagingAdapterError();
  }

  async markOutboundSucceeded(studioId: string, operationId: string, externalMessageId: string): Promise<void> {
    await this.mark(studioId, operationId, { status: "SUCCEEDED", external_message_id: externalMessageId });
  }
  async markOutboundFailed(studioId: string, operationId: string): Promise<void> { await this.mark(studioId, operationId, { status: "FAILED" }); }
  async markOutboundUnknown(studioId: string, operationId: string): Promise<void> { await this.mark(studioId, operationId, { status: "UNKNOWN" }); }

  private async mark(studioId: string, operationId: string, values: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.client.from("outbound_message_operation").update(values).eq("studio_id", studioId).eq("id", operationId).eq("status", "PENDING").select("id").maybeSingle();
    if (error || data === null) throw new SupabaseMessagingAdapterError();
  }
}

export function createSupabaseMessagingRequestAdapter(request: Request, environment: Record<string, string | undefined>): SupabaseMessagingAdapter {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseMessagingAdapter(client);
}

function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SupabaseMessagingAdapterError(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new SupabaseMessagingAdapterError(); return value; }
function integerString(value: unknown): string {
  if ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9][0-9]*$/.test(value))) return String(value);
  throw new SupabaseMessagingAdapterError();
}
