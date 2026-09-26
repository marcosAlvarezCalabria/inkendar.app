import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ConversationNotFoundError,
  ConversationProviderRejectedError,
  ConversationProviderUnavailableError,
  InvalidConversationWebhookError,
  type ConversationAttachment,
  type ConversationBatch,
  type ConversationChannel,
  type ConversationImage,
  type ConversationImageProviderPort,
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
  attachmentOrigins?: readonly string[];
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

export class ChatwootConversationAdapter implements ConversationProviderPort, ConversationImageProviderPort {
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
      .map((item) => message(item, { externalAccountId, externalConversationId, externalInboxId }, this.#connection))
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
    if (!response.ok) {
      if (response.status === 404) throw new ConversationNotFoundError();
      if (response.status >= 400 && response.status < 500) throw new ConversationProviderRejectedError();
      throw new ConversationProviderUnavailableError();
    }
    const body = await json(response);
    const row = object(body);
    if (id(row.account_id) !== this.#connection.accountId || id(row.conversation_id) !== normalizedId) throw new ConversationProviderUnavailableError();
    return { externalMessageId: id(row.id) };
  }

  async getImageAttachment(conversationId: string, messageId: string, attachmentId: string, signal?: AbortSignal): Promise<ConversationImage> {
    const conversation = normalizeExternalConversationId(conversationId);
    const message = normalizeExternalConversationId(messageId);
    const attachment = normalizeExternalConversationId(attachmentId);
    const next = Number(message) + 1;
    if (!Number.isSafeInteger(next)) throw new ConversationProviderUnavailableError();
    const body = object(await this.#get(`/api/v1/accounts/${this.#connection.accountId}/conversations/${conversation}/messages?before=${next}`, signal));
    if (!Array.isArray(body.payload) || body.payload.length > 20) throw new ConversationProviderUnavailableError();
    const row = body.payload.map(object).find((item) => id(item.id) === message);
    if (!row || row.private !== false || row.message_type !== 0 || row.content_type !== "text"
      || (row.account_id !== undefined && id(row.account_id) !== this.#connection.accountId)
      || id(row.conversation_id) !== conversation) throw new ConversationProviderUnavailableError();
    const found = rawImageAttachment(row.attachments, attachment, this.#connection, message);
    if (!found) throw new ConversationProviderUnavailableError();
    return this.#downloadImage(found.url, found.mediaType, signal);
  }

  async #downloadImage(initialUrl: string, mediaType: ConversationImage["mediaType"], signal?: AbortSignal): Promise<ConversationImage> {
    const allowed = attachmentOrigins(this.#connection);
    const timeout = AbortSignal.timeout(8_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let current = initialUrl;
    const visited = new Set<string>();
    try {
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        const parsed = safeAttachmentUrl(current, allowed);
        if (!parsed || visited.has(parsed.href)) throw new ConversationProviderUnavailableError();
        visited.add(parsed.href);
        const response = await this.#fetch(parsed.href, { redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer", signal: combined });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("Location");
          if (!location || redirects === 3) throw new ConversationProviderUnavailableError();
          current = new URL(location, parsed).href;
          await response.body?.cancel();
          continue;
        }
        if (response.status !== 200 || response.headers.get("Content-Type")?.trim().toLowerCase() !== mediaType) throw new ConversationProviderUnavailableError();
        const declared = response.headers.get("Content-Length");
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) throw new ConversationProviderUnavailableError();
        const bytes = await boundedImageBytes(response, combined);
        const dimensions = inspectImage(bytes, mediaType);
        if (!dimensions) throw new ConversationProviderUnavailableError();
        return { bytes, mediaType, ...dimensions };
      }
    } catch {
      throw new ConversationProviderUnavailableError();
    }
    throw new ConversationProviderUnavailableError();
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
        redirect: "manual",
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
  const attachmentOrigins = row.attachmentOrigins === undefined ? undefined : configuredAttachmentOrigins(row.attachmentOrigins);
  return { connectionId, studioId: normalizeResourceId("id", string(row.studioId)), baseUrl, accountId: id(row.accountId), apiAccessToken, webhookSecret, ...(attachmentOrigins ? { attachmentOrigins } : {}) };
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

function message(value: unknown, expected: Readonly<{ externalAccountId: string; externalConversationId: string; externalInboxId: string }>, connection: ChatwootConnection): ConversationMessage | null {
  const row = object(value);
  if (row.private !== false || row.content_type !== "text" || (row.message_type !== 0 && row.message_type !== 1)) return null;
  if (
    (row.account_id !== undefined && id(row.account_id) !== expected.externalAccountId)
    || id(row.conversation_id) !== expected.externalConversationId
    || id(row.inbox_id) !== expected.externalInboxId
  ) throw new ConversationProviderUnavailableError();
  if (row.content !== null && typeof row.content !== "string") throw new ConversationProviderUnavailableError();
  const content = row.content === null ? "" : row.content.normalize("NFKC").trim();
  if (content.length > 10_000) throw new ConversationProviderUnavailableError();
  const attachments = row.message_type === 0 ? normalizedAttachments(row.attachments, row, connection) : [];
  if (content.length === 0 && attachments.length === 0) return null;
  return { id: id(row.id), direction: row.message_type === 0 ? "incoming" : "outgoing", content, createdAt: timestampIso(row.created_at), ...(attachments.length ? { attachments } : {}) };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;
type ImageMediaType = ConversationImage["mediaType"];

function normalizedAttachments(value: unknown, message: Record<string, unknown>, connection: ChatwootConnection): ConversationAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return [{ kind: "unsupported" }];
  return value.map((item) => {
    try {
      const row = object(item);
      const attachmentId = id(row.id);
      return rawImageAttachment([row], attachmentId, connection, id(message.id))
        ? { kind: "image" as const, id: attachmentId }
        : { kind: "unsupported" as const };
    } catch { return { kind: "unsupported" as const }; }
  });
}

function rawImageAttachment(value: unknown, attachmentId: string, connection: ChatwootConnection, messageId: string): { url: string; mediaType: ImageMediaType } | null {
  if (!Array.isArray(value)) return null;
  const allowed = attachmentOrigins(connection);
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    try {
      if (id(row.id) !== attachmentId || row.file_type !== "image" || !imageMediaType(row.content_type)) continue;
      if (row.message_id !== undefined && id(row.message_id) !== messageId) continue;
      if (row.account_id !== undefined && id(row.account_id) !== connection.accountId) continue;
      if (row.file_size != null && (!Number.isSafeInteger(row.file_size) || Number(row.file_size) < 1 || Number(row.file_size) > MAX_IMAGE_BYTES)) continue;
      if (row.width != null && (!Number.isSafeInteger(row.width) || Number(row.width) < 1 || Number(row.width) > MAX_IMAGE_SIDE)) continue;
      if (row.height != null && (!Number.isSafeInteger(row.height) || Number(row.height) < 1 || Number(row.height) > MAX_IMAGE_SIDE)) continue;
      const parsed = safeAttachmentUrl(row.data_url, allowed);
      if (parsed) return { url: parsed.href, mediaType: row.content_type };
    } catch { /* Malformed provider attachment is not renderable. */ }
  }
  return null;
}

function imageMediaType(value: unknown): value is ImageMediaType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function configuredAttachmentOrigins(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 8 || !value.every((item) => typeof item === "string")) throw new Error();
  const origins = value.map((item) => url(item));
  if (origins.some((origin) => !publicHostname(new URL(origin).hostname)) || new Set(origins).size !== origins.length) throw new Error();
  return origins;
}

function attachmentOrigins(connection: ChatwootConnection): ReadonlySet<string> {
  return new Set([connection.baseUrl, ...(connection.attachmentOrigins ?? [])]);
}

function safeAttachmentUrl(value: unknown, allowedOrigins: ReadonlySet<string>): URL | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash
      || !allowedOrigins.has(parsed.origin) || !publicHostname(parsed.hostname)) return null;
    return parsed;
  } catch { return null; }
}

function publicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.includes(".") && !/^\d+(?:\.\d+){3}$/.test(host) && !host.includes(":")
    && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal");
}

async function boundedImageBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new ConversationProviderUnavailableError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new ConversationProviderUnavailableError();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) throw new ConversationProviderUnavailableError();
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new ConversationProviderUnavailableError();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function inspectImage(bytes: Uint8Array, mediaType: ImageMediaType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0;
  if (mediaType === "image/png") {
    if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part)
      || view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== "IHDR" || !validPngStructure(bytes, view)) return null;
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mediaType === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) return null;
      let marker = bytes[offset + 1] ?? 0;
      while (marker === 0xff) { offset += 1; marker = bytes[offset + 1] ?? 0; }
      if (marker === 0xda) break;
      if (offset + 4 > bytes.length) return null;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) return null;
        height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); break;
      }
      offset += 2 + length;
    }
  } else {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || view.getUint32(4, true) + 8 !== bytes.length) return null;
    const type = ascii(bytes, 12, 4);
    if (type === "VP8X") {
      width = 1 + little24(bytes, 24); height = 1 + little24(bytes, 27);
    } else if (type === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + (((bytes[22] ?? 0) & 0x3f) << 8 | (bytes[21] ?? 0));
      height = 1 + (((bytes[24] ?? 0) & 0x0f) << 10 | ((bytes[23] ?? 0) << 2) | ((bytes[22] ?? 0) >> 6));
    } else if (type === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else return null;
  }
  return width > 0 && height > 0 && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_PIXELS
    ? { width, height } : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function validPngStructure(bytes: Uint8Array, view: DataView): boolean {
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (type === "IDAT" && length > 0) imageData = true;
    offset += length + 12;
    if (type === "IEND") return imageData && length === 0 && offset === bytes.length;
  }
  return false;
}

function little24(bytes: Uint8Array, start: number): number {
  return (bytes[start] ?? 0) | ((bytes[start + 1] ?? 0) << 8) | ((bytes[start + 2] ?? 0) << 16);
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
