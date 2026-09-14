import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ConversationNotFoundError,
  ConversationProviderRejectedError,
  ConversationProviderUnavailableError,
  InvalidConversationWebhookError,
  type ConversationBatch,
  type ConversationChannel,
  type ConversationMessage,
  type ConversationProviderPort,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationThread,
  type ConversationWebhookEvent,
} from "@inkendar/application";
import { normalizeExternalConversationId, normalizeResourceId } from "@inkendar/domain";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ChatwootConnection = Readonly<{
  connectionId: string;
  studioId: string;
  baseUrl: string;
  accountId: string;
  apiAccessToken: string;
  webhookSecret: string;
}>;

export class ChatwootConnections {
  readonly #connections: readonly ChatwootConnection[];

  constructor(serialized: string | undefined) {
    if (serialized === undefined || serialized.trim() === "") {
      this.#connections = [];
      return;
    }
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!Array.isArray(parsed)) throw new Error();
      this.#connections = parsed.map(connection);
      if (new Set(this.#connections.map((item) => item.studioId)).size !== this.#connections.length) throw new Error();
      if (new Set(this.#connections.map((item) => item.connectionId)).size !== this.#connections.length) throw new Error();
      if (new Set(this.#connections.map(providerAccountKey)).size !== this.#connections.length) throw new Error();
    } catch {
      throw new ConversationProviderUnavailableError();
    }
  }

  forStudio(studioId: string): ChatwootConnection | null {
    return this.#connections.find((item) => item.studioId === studioId) ?? null;
  }

  forWebhook(connectionId: string): ChatwootConnection {
    const found = this.#connections.find((item) => item.connectionId === connectionId);
    if (!found) throw new ConversationProviderUnavailableError();
    return found;
  }
}

export class ChatwootConversationAdapter implements ConversationProviderPort {
  readonly #connection: ChatwootConnection;
  readonly #fetch: Fetch;

  constructor(connection: ChatwootConnection, fetcher: Fetch = globalThis.fetch.bind(globalThis)) {
    this.#connection = connection;
    this.#fetch = fetcher;
  }

  async listConversations(page: number, signal?: AbortSignal): Promise<ConversationBatch> {
    const body = await this.#get(`/api/v1/accounts/${this.#connection.accountId}/conversations?status=all&page=${page}`, signal);
    const data = object(object(body).data);
    const payload = data.payload;
    if (!Array.isArray(payload) || payload.length > 25) throw new ConversationProviderUnavailableError();
    return {
      items: payload.map((item) => summary(item, this.#connection.accountId)).sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt)),
      totalCount: nonNegativeInteger(object(data.meta).all_count),
    };
  }

  async getConversation(conversationId: string, before?: string, signal?: AbortSignal): Promise<ConversationThread> {
    const normalizedId = normalizeExternalConversationId(conversationId);
    const body = object(await this.#get(`/api/v1/accounts/${this.#connection.accountId}/conversations/${normalizedId}`, signal));
    const externalAccountId = id(body.account_id);
    const externalConversationId = id(body.id);
    const externalInboxId = id(body.inbox_id);
    if (externalAccountId !== this.#connection.accountId || externalConversationId !== normalizedId) throw new ConversationProviderUnavailableError();
    const beforeQuery = before === undefined ? "" : `?before=${encodeURIComponent(before)}`;
    const messages = object(await this.#get(`/api/v1/accounts/${this.#connection.accountId}/conversations/${normalizedId}/messages${beforeQuery}`, signal)).payload;
    if (!Array.isArray(messages) || messages.length > 20) throw new ConversationProviderUnavailableError();
    const normalizedMessages = messages
      .map((item) => message(item, { externalAccountId, externalConversationId, externalInboxId }))
      .filter((item): item is ConversationMessage => item !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const nextBefore = messages.length === 20 ? id(object(messages[0]).id) : null;
    return { id: externalConversationId, inboxId: externalInboxId, canReply: boolean(body.can_reply), messages: normalizedMessages, before: nextBefore === before ? null : nextBefore };
  }

  async sendReply(conversationId: string, content: string, signal?: AbortSignal): Promise<Readonly<{ externalMessageId: string }>> {
    const normalizedId = normalizeExternalConversationId(conversationId);
    const response = await this.#request(`/api/v1/accounts/${this.#connection.accountId}/conversations/${normalizedId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, message_type: "outgoing", private: false, content_type: "text" }),
    }, signal);
    const body = await json(response);
    if (!response.ok) {
      if (response.status === 404) throw new ConversationNotFoundError();
      if (response.status >= 400 && response.status < 500) throw new ConversationProviderRejectedError();
      throw new ConversationProviderUnavailableError();
    }
    const row = object(body);
    if (id(row.account_id) !== this.#connection.accountId || id(row.conversation_id) !== normalizedId) throw new ConversationProviderUnavailableError();
    return { externalMessageId: id(row.id) };
  }

  async #get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.#request(path, {}, signal);
    const body = await json(response);
    if (!response.ok) {
      if (response.status === 404) throw new ConversationNotFoundError();
      throw new ConversationProviderUnavailableError();
    }
    return body;
  }

  async #request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.#fetch(`${this.#connection.baseUrl}${path}`, {
        ...init,
        headers: { api_access_token: this.#connection.apiAccessToken, ...init.headers },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
      });
    } catch {
      throw new ConversationProviderUnavailableError();
    }
  }
}

export function verifyChatwootWebhook(input: Readonly<{ connection: ChatwootConnection; rawBody: string; headers: Headers; now?: Date }>): ConversationWebhookEvent {
  const signature = input.headers.get("X-Chatwoot-Signature") ?? "";
  const timestamp = input.headers.get("X-Chatwoot-Timestamp") ?? "";
  const deliveryId = input.headers.get("X-Chatwoot-Delivery") ?? "";
  if (Buffer.byteLength(input.rawBody, "utf8") > 262_144 || !/^[0-9]{1,12}$/.test(timestamp) || !/^[A-Za-z0-9._:-]{1,200}$/.test(deliveryId) || !/^sha256=[a-f0-9]{64}$/.test(signature)) invalidWebhook();

  const signedAt = Number(timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowSeconds - signedAt) > 300) invalidWebhook();
  const expected = `sha256=${createHmac("sha256", input.connection.webhookSecret).update(`${timestamp}.${input.rawBody}`).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) invalidWebhook();

  try {
    const payload = object(JSON.parse(input.rawBody));
    if (payload.event !== "message_created") invalidWebhook();
    const externalAccountId = id(object(payload.account).id);
    if (externalAccountId !== input.connection.accountId) invalidWebhook();
    const inbox = object(payload.inbox);
    const conversation = object(payload.conversation);
    const externalInboxId = id(inbox.id);
    if (id(conversation.account_id) !== externalAccountId || id(conversation.inbox_id) !== externalInboxId) invalidWebhook();
    return {
      deliveryId,
      externalAccountId,
      externalInboxId,
      externalConversationId: id(conversation.id),
      externalMessageId: id(payload.id),
      occurredAt: timestampIso(payload.created_at),
    };
  } catch (error) {
    if (error instanceof InvalidConversationWebhookError) throw error;
    throw new InvalidConversationWebhookError();
  }
}

function connection(value: unknown): ChatwootConnection {
  const row = object(value);
  const baseUrl = url(string(row.baseUrl));
  const connectionId = string(row.connectionId);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(connectionId)) throw new Error();
  const apiAccessToken = string(row.apiAccessToken);
  const webhookSecret = string(row.webhookSecret);
  if (apiAccessToken.length < 16 || webhookSecret.length < 16) throw new Error();
  return { connectionId, studioId: normalizeResourceId("id", string(row.studioId)), baseUrl, accountId: id(row.accountId), apiAccessToken, webhookSecret };
}

function providerAccountKey(value: ChatwootConnection): string {
  return `${value.baseUrl}\u0000${value.accountId}`;
}

function url(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error();
  return parsed.origin;
}

function summary(value: unknown, expectedAccountId: string): ConversationSummary {
  const row = object(value);
  if (id(row.account_id) !== expectedAccountId) throw new ConversationProviderUnavailableError();
  const meta = object(row.meta);
  const sender = object(meta.sender);
  return {
    id: id(row.id), inboxId: id(row.inbox_id), status: status(row.status), channel: channel(meta.channel),
    contactName: displayName(sender.name), unreadCount: nonNegativeInteger(row.unread_count), lastActivityAt: timestampIso(row.last_activity_at), canReply: boolean(row.can_reply),
  };
}

function message(value: unknown, expected: Readonly<{ externalAccountId: string; externalConversationId: string; externalInboxId: string }>): ConversationMessage | null {
  const row = object(value);
  if (row.private !== false || row.content_type !== "text" || (row.message_type !== 0 && row.message_type !== 1)) return null;
  if (
    id(row.account_id) !== expected.externalAccountId
    || id(row.conversation_id) !== expected.externalConversationId
    || id(row.inbox_id) !== expected.externalInboxId
  ) throw new ConversationProviderUnavailableError();
  const content = string(row.content).normalize("NFKC").trim();
  if (content.length === 0 || content.length > 10_000) throw new ConversationProviderUnavailableError();
  return { id: id(row.id), direction: row.message_type === 0 ? "incoming" : "outgoing", content, createdAt: timestampIso(row.created_at) };
}

function id(value: unknown): string {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "number" && !Number.isSafeInteger(value))) throw new ConversationProviderUnavailableError();
  try { return normalizeExternalConversationId(String(value)); } catch { throw new ConversationProviderUnavailableError(); }
}

function timestampIso(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new ConversationProviderUnavailableError();
  const result = new Date(numeric * 1_000);
  if (Number.isNaN(result.getTime())) throw new ConversationProviderUnavailableError();
  return result.toISOString();
}

function status(value: unknown): ConversationStatus {
  if (value === "open" || value === "pending" || value === "resolved" || value === "snoozed") return value;
  throw new ConversationProviderUnavailableError();
}

function channel(value: unknown): ConversationChannel {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("facebook")) return "facebook";
  if (normalized.includes("web")) return "web";
  return "unknown";
}

function displayName(value: unknown): string {
  if (typeof value !== "string") return "Contacto sin nombre";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= 120 ? normalized : "Contacto sin nombre";
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConversationProviderUnavailableError();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value.trim();
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ConversationProviderUnavailableError();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ConversationProviderUnavailableError();
  return value;
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new ConversationProviderUnavailableError(); }
}

function invalidWebhook(): never {
  throw new InvalidConversationWebhookError();
}
