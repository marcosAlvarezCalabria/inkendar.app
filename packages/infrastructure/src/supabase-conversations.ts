import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ConversationLink, ConversationLinksRepositoryPort, ConversationWebhookEvent, ConversationWebhookRepositoryPort, WebhookIngestionResult } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type DataResult = Readonly<{ data: unknown; error: unknown }>;
export interface ConversationsDataGateway {
  listLinks(filters: Readonly<Record<string, string>>): Promise<DataResult>;
  upsertLink(values: Readonly<Record<string, unknown>>): Promise<DataResult>;
  recordWebhook(parameters: Readonly<Record<string, string>>): Promise<DataResult>;
}

export class SupabaseConversationsGateway implements ConversationsDataGateway {
  constructor(private readonly client: SupabaseClient) {}
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
}

export class SupabaseConversationsAdapterError extends Error {
  readonly code = "SUPABASE_CONVERSATIONS_FAILED";
  constructor() { super("Conversation persistence failed"); this.name = "SupabaseConversationsAdapterError"; }
}

const COLUMNS = "id,studio_id,external_account_id,external_inbox_id,external_conversation_id,customer_id,tattoo_case_id,last_external_message_id,last_activity_at";

export class SupabaseConversationsAdapter implements ConversationLinksRepositoryPort, ConversationWebhookRepositoryPort {
  constructor(private readonly data: ConversationsDataGateway) {}
  async listLinks(studioId: string, externalAccountId: string): Promise<readonly ConversationLink[]> {
    const result = await this.data.listLinks({ studio_id: studioId, provider: "chatwoot", external_account_id: externalAccountId });
    if (result.error || !Array.isArray(result.data)) throw new SupabaseConversationsAdapterError();
    return result.data.map(link);
  }
  async saveLink(input: Readonly<{ studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null }>): Promise<ConversationLink> {
    const result = await this.data.upsertLink({ studio_id: input.studioId, provider: "chatwoot", external_account_id: input.externalAccountId, external_inbox_id: input.externalInboxId, external_conversation_id: input.externalConversationId, customer_id: input.customerId, tattoo_case_id: input.tattooCaseId });
    if (result.error || result.data === null) throw new SupabaseConversationsAdapterError();
    return link(result.data);
  }
  async record(studioId: string, event: ConversationWebhookEvent): Promise<WebhookIngestionResult> {
    const result = await this.data.recordWebhook({ p_studio_id: studioId, p_provider: "chatwoot", p_delivery_id: event.deliveryId, p_event_name: "message_created", p_external_account_id: event.externalAccountId, p_external_inbox_id: event.externalInboxId, p_external_conversation_id: event.externalConversationId, p_external_message_id: event.externalMessageId, p_occurred_at: event.occurredAt });
    if (result.error || (result.data !== "ACCEPTED" && result.data !== "DUPLICATE")) throw new SupabaseConversationsAdapterError();
    return result.data;
  }
}

export function createSupabaseConversationsRequestAdapter(request: Request, environment: Record<string, string | undefined>): SupabaseConversationsAdapter {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, { cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined } });
  return new SupabaseConversationsAdapter(new SupabaseConversationsGateway(client));
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
