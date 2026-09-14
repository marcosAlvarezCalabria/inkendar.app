import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ConversationLink, ConversationLinksRepositoryPort, ConversationOutboundRepositoryPort, ConversationWebhookEvent, ConversationWebhookRepositoryPort, OutboundClaim, WebhookIngestionResult } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type DataResult = Readonly<{ data: unknown; error: unknown }>;
export interface ConversationsDataGateway {
  listLinks(filters: Readonly<Record<string, string>>): Promise<DataResult>;
  upsertLink(values: Readonly<Record<string, unknown>>): Promise<DataResult>;
  recordWebhook(parameters: Readonly<Record<string, string>>): Promise<DataResult>;
  claimOutbound?(parameters: Readonly<Record<string, string>>): Promise<DataResult>;
  transitionOutbound?(parameters: Readonly<Record<string, string | null>>): Promise<DataResult>;
}

export class SupabaseConversationsGateway implements ConversationsDataGateway {
  constructor(private readonly client: SupabaseClient, private readonly serviceClientSource?: () => SupabaseClient) {}
  private serviceClient(): SupabaseClient { return this.serviceClientSource?.() ?? this.client; }

  async listLinks(filters: Readonly<Record<string, string>>): Promise<DataResult> {
    let query = this.client.from("conversation_link").select(COLUMNS);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.order("last_activity_at", { ascending: false, nullsFirst: false });
    return { data, error };
  }
  async upsertLink(values: Readonly<Record<string, unknown>>): Promise<DataResult> {
    const { data, error } = await this.client.from("conversation_link").upsert(values, { onConflict: "studio_id,provider,external_account_id,external_conversation_id" }).select(COLUMNS).single();
    return { data, error };
  }
  async recordWebhook(parameters: Readonly<Record<string, string>>): Promise<DataResult> {
    const { data, error } = await this.client.rpc("ingest_conversation_webhook", parameters);
    return { data, error };
  }
  async claimOutbound(parameters: Readonly<Record<string, string>>): Promise<DataResult> {
    const { data, error } = await this.serviceClient().rpc("claim_conversation_outbound_operation", parameters);
    return { data, error };
  }
  async transitionOutbound(parameters: Readonly<Record<string, string | null>>): Promise<DataResult> {
    const { data, error } = await this.serviceClient().rpc("transition_conversation_outbound_operation", parameters);
    return { data, error };
  }
}

export class SupabaseConversationsAdapterError extends Error {
  readonly code = "SUPABASE_CONVERSATIONS_FAILED";
  constructor() { super("Conversation persistence failed"); this.name = "SupabaseConversationsAdapterError"; }
}

const COLUMNS = "id,studio_id,external_account_id,external_inbox_id,external_conversation_id,customer_id,tattoo_case_id,last_external_message_id,last_activity_at";

export class SupabaseConversationsAdapter implements ConversationLinksRepositoryPort, ConversationOutboundRepositoryPort, ConversationWebhookRepositoryPort {
  constructor(private readonly data: ConversationsDataGateway) {}

  async listLinks(studioId: string, externalAccountId: string): Promise<readonly ConversationLink[]> {
    const result = await this.data.listLinks({ studio_id: studioId, provider: "chatwoot", external_account_id: externalAccountId });
    if (result.error || !Array.isArray(result.data)) throw new SupabaseConversationsAdapterError();
    const links = result.data.map(link);
    if (links.some((item) => item.studioId !== studioId || item.externalAccountId !== externalAccountId)) throw new SupabaseConversationsAdapterError();
    return links;
  }
  async saveLink(input: Readonly<{ studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null }>): Promise<ConversationLink> {
    const result = await this.data.upsertLink({ studio_id: input.studioId, provider: "chatwoot", external_account_id: input.externalAccountId, external_inbox_id: input.externalInboxId, external_conversation_id: input.externalConversationId, customer_id: input.customerId, tattoo_case_id: input.tattooCaseId });
    if (result.error || result.data === null) throw new SupabaseConversationsAdapterError();
    const saved = link(result.data);
    if (saved.studioId !== input.studioId || saved.externalAccountId !== input.externalAccountId || saved.externalInboxId !== input.externalInboxId || saved.externalConversationId !== input.externalConversationId || saved.customerId !== input.customerId || saved.tattooCaseId !== input.tattooCaseId) throw new SupabaseConversationsAdapterError();
    return saved;
  }
  async record(studioId: string, event: ConversationWebhookEvent): Promise<WebhookIngestionResult> {
    const result = await this.data.recordWebhook({ p_studio_id: studioId, p_provider: "chatwoot", p_delivery_id: event.deliveryId, p_event_name: "message_created", p_external_account_id: event.externalAccountId, p_external_inbox_id: event.externalInboxId, p_external_conversation_id: event.externalConversationId, p_external_message_id: event.externalMessageId, p_occurred_at: event.occurredAt });
    if (result.error || (result.data !== "ACCEPTED" && result.data !== "DUPLICATE")) throw new SupabaseConversationsAdapterError();
    return result.data;
  }
  async claim(studioId: string, externalAccountId: string, externalConversationId: string, idempotencyKey: string): Promise<OutboundClaim> {
    if (!this.data.claimOutbound) throw new SupabaseConversationsAdapterError();
    const result = await this.data.claimOutbound({ p_studio_id: studioId, p_provider: "chatwoot", p_external_account_id: externalAccountId, p_external_conversation_id: externalConversationId, p_idempotency_key: idempotencyKey });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1) throw new SupabaseConversationsAdapterError();
    const row = object(result.data[0]);
    const claimStatus = string(row.claim_status);
    if (claimStatus === "CLAIMED") return { kind: "CLAIMED", operationId: string(row.operation_id) };
    if (claimStatus === "SUCCEEDED") return { kind: "SUCCEEDED", externalMessageId: string(row.external_message_id) };
    if (claimStatus === "PENDING" || claimStatus === "FAILED" || claimStatus === "UNKNOWN") return { kind: claimStatus };
    throw new SupabaseConversationsAdapterError();
  }
  markSucceeded(studioId: string, operationId: string, externalMessageId: string): Promise<void> { return this.transition(studioId, operationId, "SUCCEEDED", externalMessageId); }
  markFailed(studioId: string, operationId: string): Promise<void> { return this.transition(studioId, operationId, "FAILED", null); }
  markUnknown(studioId: string, operationId: string): Promise<void> { return this.transition(studioId, operationId, "UNKNOWN", null); }

  private async transition(studioId: string, operationId: string, status: string, externalMessageId: string | null): Promise<void> {
    if (!this.data.transitionOutbound) throw new SupabaseConversationsAdapterError();
    const result = await this.data.transitionOutbound({ p_studio_id: studioId, p_operation_id: operationId, p_status: status, p_external_message_id: externalMessageId });
    if (result.error) throw new SupabaseConversationsAdapterError();
  }
}

export function createSupabaseConversationsRequestAdapter(request: Request, environment: Record<string, string | undefined>): SupabaseConversationsAdapter {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseConversationsAdapter(new SupabaseConversationsGateway(client, () => {
    const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) throw new SupabaseConversationsAdapterError();
    return createClient(config.url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }));
}

export function createSupabaseConversationsWebhookAdapter(environment: Record<string, string | undefined>): SupabaseConversationsAdapter {
  const config = loadSupabasePublicConfig(environment);
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new SupabaseConversationsAdapterError();
  const client = createClient(config.url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseConversationsAdapter(new SupabaseConversationsGateway(client));
}

function link(value: unknown): ConversationLink {
  const row = object(value);
  return { id: string(row.id), studioId: string(row.studio_id), externalAccountId: string(row.external_account_id), externalInboxId: string(row.external_inbox_id), externalConversationId: string(row.external_conversation_id), customerId: string(row.customer_id), tattooCaseId: nullableString(row.tattoo_case_id), lastExternalMessageId: nullableString(row.last_external_message_id), lastActivityAt: nullableString(row.last_activity_at) };
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SupabaseConversationsAdapterError();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new SupabaseConversationsAdapterError();
  return value;
}
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
