import {
  MessagingProviderOutcomeUnknownError,
  MessagingProviderRejectedError,
  MessagingProviderUnavailableError,
  type ConversationMessage,
  type ConversationSummary,
  type InboxProviderPort,
  type MessagingConnection,
} from "@inkendar/application";

export interface CredentialResolverPort { resolve(reference: string): Promise<string>; }
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class MessagingProviderConfigurationError extends Error {
  readonly code = "MESSAGING_PROVIDER_CONFIGURATION";
  constructor() { super("Messaging provider configuration invalid"); this.name = "MessagingProviderConfigurationError"; }
}

export class EnvironmentCredentialResolver implements CredentialResolverPort {
  private readonly credentials: Readonly<Record<string, string>>;
  constructor(serialized: string) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!isObject(parsed)) throw new Error();
      const entries = Object.entries(parsed);
      if (entries.some(([key, value]) => !key || typeof value !== "string" || !value)) throw new Error();
      this.credentials = Object.fromEntries(entries) as Record<string, string>;
    } catch {
      throw new MessagingProviderConfigurationError();
    }
  }
  async resolve(reference: string): Promise<string> {
    const value = this.credentials[reference];
    if (!value) throw new Error("Messaging credential unavailable");
    return value;
  }
}

export function loadMessagingProviderConfig(environment: Record<string, string | undefined>): { baseUrl: string; resolver: EnvironmentCredentialResolver } {
  const rawUrl = environment.INKENDAR_MESSAGING_BASE_URL;
  const rawCredentials = environment.INKENDAR_MESSAGING_CREDENTIALS_JSON;
  if (!rawUrl || !rawCredentials) throw new MessagingProviderConfigurationError();
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new MessagingProviderConfigurationError(); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== rawUrl) {
    throw new MessagingProviderConfigurationError();
  }
  return { baseUrl: parsed.origin, resolver: new EnvironmentCredentialResolver(rawCredentials) };
}

export class ChatwootInboxAdapter implements InboxProviderPort {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: CredentialResolverPort,
    private readonly fetcher: Fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async listOpenConversations(connection: MessagingConnection, signal?: AbortSignal): Promise<readonly ConversationSummary[]> {
    const accountId = positiveInteger(connection.externalAccountId);
    const response = await this.read(`${this.baseUrl}/api/v1/accounts/${accountId}/conversations?status=open&page=1`, connection, signal);
    try {
      const data = object(object(response).data);
      return array(data.payload).map(conversation);
    } catch { throw new MessagingProviderUnavailableError(); }
  }

  async getMessages(connection: MessagingConnection, externalConversationId: string, signal?: AbortSignal): Promise<readonly ConversationMessage[]> {
    const accountId = positiveInteger(connection.externalAccountId);
    const conversationId = positiveInteger(externalConversationId);
    const response = await this.read(`${this.baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, connection, signal);
    try {
      return array(object(response).payload).flatMap((value): ConversationMessage[] => {
        const row = object(value);
        if (row.private === true || (row.message_type !== 0 && row.message_type !== 1) || row.content_type !== "text" || typeof row.content !== "string" || !row.content) return [];
        return [{ id: numericId(row.id), content: row.content, direction: row.message_type === 0 ? "INCOMING" : "OUTGOING", createdAt: finiteNumber(row.created_at) }];
      });
    } catch { throw new MessagingProviderUnavailableError(); }
  }

  async sendReply(connection: MessagingConnection, externalConversationId: string, content: string, signal?: AbortSignal): Promise<{ externalMessageId: string }> {
    const accountId = positiveInteger(connection.externalAccountId);
    const conversationId = positiveInteger(externalConversationId);
    const url = `${this.baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
    const token = await this.credential(connection);
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", api_access_token: token },
        body: JSON.stringify({ content, message_type: "outgoing", private: false, content_type: "text" }),
        signal: timedSignal(signal, this.timeoutMs),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) throw new MessagingProviderRejectedError();
        throw new MessagingProviderOutcomeUnknownError();
      }
      const payload: unknown = await response.json();
      return { externalMessageId: numericId(object(payload).id) };
    } catch (error: unknown) {
      if (error instanceof MessagingProviderRejectedError || error instanceof MessagingProviderOutcomeUnknownError) throw error;
      throw new MessagingProviderOutcomeUnknownError();
    }
  }

  private async read(url: string, connection: MessagingConnection, signal?: AbortSignal): Promise<unknown> {
    const token = await this.credential(connection);
    try {
      const response = await this.fetcher(url, { headers: { Accept: "application/json", api_access_token: token }, signal: timedSignal(signal, this.timeoutMs) });
      if (!response.ok) throw new MessagingProviderUnavailableError();
      return await response.json() as unknown;
    } catch (error: unknown) {
      if (error instanceof MessagingProviderUnavailableError) throw error;
      throw new MessagingProviderUnavailableError();
    }
  }

  private async credential(connection: MessagingConnection): Promise<string> {
    try { return await this.credentials.resolve(connection.credentialReference); }
    catch { throw new MessagingProviderUnavailableError(); }
  }
}

function conversation(value: unknown): ConversationSummary {
  const row = object(value);
  if (row.status !== "open") throw new Error();
  const id = numericId(row.id);
  const sender = isObject(row.meta) && isObject(row.meta.sender) ? row.meta.sender : {};
  const last = isObject(row.last_non_activity_message) ? row.last_non_activity_message : {};
  return {
    id,
    title: typeof sender.name === "string" && sender.name.trim() ? sender.name.trim() : `Conversación ${id}`,
    lastMessagePreview: typeof last.content === "string" && last.content ? last.content : null,
    lastActivityAt: finiteNumber(row.last_activity_at),
    unreadCount: nonNegativeInteger(row.unread_count),
  };
}

function timedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function positiveInteger(value: string): string { if (!/^[1-9][0-9]*$/.test(value)) throw new MessagingProviderConfigurationError(); return value; }
function numericId(value: unknown): string { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(); return String(value); }
function finiteNumber(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(); return value; }
function nonNegativeInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(); return value; }
function object(value: unknown): Record<string, unknown> { if (!isObject(value)) throw new Error(); return value; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error(); return value; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
