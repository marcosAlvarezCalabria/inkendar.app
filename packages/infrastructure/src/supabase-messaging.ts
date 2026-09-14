import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConversationLink, MessagingConnection, MessagingRepositoryPort, OutboundClaim } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

export class SupabaseMessagingAdapterError extends Error {
  readonly code = "SUPABASE_MESSAGING_FAILED";
  constructor() { super("Messaging persistence failed"); this.name = "SupabaseMessagingAdapterError"; }
}

export class SupabaseMessagingAdapter implements MessagingRepositoryPort {
  constructor(private readonly client: SupabaseClient, private readonly serviceClientSource: SupabaseClient | (() => SupabaseClient)) {}
  private serviceClient(): SupabaseClient { return typeof this.serviceClientSource === "function" ? this.serviceClientSource() : this.serviceClientSource; }

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
    const { error } = await this.serviceClient().rpc("upsert_conversation_links", {
      p_studio_id: studioId, p_integration_connection_id: connectionId, p_external_conversation_ids: [...externalConversationIds],
    });
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

  async claimOutboundOperation(studioId: string, connectionId: string, externalConversationId: string, idempotencyKey: string): Promise<OutboundClaim> {
    const { data, error } = await this.serviceClient().rpc("claim_outbound_message_operation", {
      p_studio_id: studioId, p_integration_connection_id: connectionId, p_external_conversation_id: externalConversationId, p_idempotency_key: idempotencyKey,
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new SupabaseMessagingAdapterError();
    const row = object(data[0]); const status = string(row.claim_status);
    if (status === "CLAIMED") return { kind: "CLAIMED", operationId: string(row.operation_id) };
    if (status === "SUCCEEDED") return { kind: "SUCCEEDED", externalMessageId: integerString(row.external_message_id) };
    if (status === "PENDING" || status === "UNKNOWN" || status === "FAILED") return { kind: status };
    throw new SupabaseMessagingAdapterError();
  }

  async markOutboundSucceeded(studioId: string, operationId: string, externalMessageId: string): Promise<void> {
    await this.mark(studioId, operationId, { status: "SUCCEEDED", external_message_id: externalMessageId });
  }
  async markOutboundFailed(studioId: string, operationId: string): Promise<void> { await this.mark(studioId, operationId, { status: "FAILED" }); }
  async markOutboundUnknown(studioId: string, operationId: string): Promise<void> { await this.mark(studioId, operationId, { status: "UNKNOWN" }); }

  private async mark(studioId: string, operationId: string, values: Record<string, unknown>): Promise<void> {
    const { status, external_message_id = null } = values;
    const { error } = await this.serviceClient().rpc("transition_outbound_message_operation", { p_studio_id: studioId, p_operation_id: operationId, p_status: status, p_external_message_id: external_message_id });
    if (error) throw new SupabaseMessagingAdapterError();
  }
}

export function createSupabaseMessagingRequestAdapter(request: Request, environment: Record<string, string | undefined>): SupabaseMessagingAdapter {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseMessagingAdapter(client, () => {
    const service = loadSupabaseMessagingServiceConfig(environment);
    return createClient(service.url, service.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  });
}

export function loadSupabaseMessagingServiceConfig(environment: Record<string, string | undefined>): { url: string; serviceRoleKey: string } {
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing server environment: SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing server environment: SUPABASE_SERVICE_ROLE_KEY");
  return { url, serviceRoleKey };
}

function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SupabaseMessagingAdapterError(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new SupabaseMessagingAdapterError(); return value; }
function integerString(value: unknown): string {
  if ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9][0-9]*$/.test(value))) return String(value);
  throw new SupabaseMessagingAdapterError();
}
