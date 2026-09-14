import { normalizeConversationId, normalizeConversationPage, normalizeIdempotencyKey, normalizeMessageBefore, normalizeReplyText } from "@inkendar/domain";

export { InvalidMessagingInputError } from "@inkendar/domain";

export type MessagingConnection = Readonly<{
  id: string;
  studioId: string;
  externalAccountId: string;
  credentialReference: string;
}>;

export type ConversationLink = Readonly<{
  id: string;
  studioId: string;
  connectionId: string;
  externalConversationId: string;
}>;

export type ConversationSummary = Readonly<{
  id: string;
  title: string;
  lastMessagePreview: string | null;
  lastActivityAt: number;
  unreadCount: number;
}>;

export type ConversationMessage = Readonly<{
  id: string;
  content: string;
  direction: "INCOMING" | "OUTGOING";
  createdAt: number;
}>;

export type ConversationPage = Readonly<{
  items: readonly ConversationSummary[];
  page: number;
  pageSize: 25;
  totalCount: number;
  previousPage: number | null;
  nextPage: number | null;
}>;

export type MessagePage = Readonly<{
  items: readonly ConversationMessage[];
  before: string | null;
}>;

export type ConversationBatch = Readonly<{ items: readonly ConversationSummary[]; totalCount: number }>;

export type OutboundClaim =
  | Readonly<{ kind: "CLAIMED"; operationId: string }>
  | Readonly<{ kind: "SUCCEEDED"; externalMessageId: string }>
  | Readonly<{ kind: "PENDING" }>
  | Readonly<{ kind: "UNKNOWN" }>;

export interface MessagingRepositoryPort {
  findActiveConnection(studioId: string): Promise<MessagingConnection | null>;
  upsertConversationLinks(studioId: string, connectionId: string, externalConversationIds: readonly string[]): Promise<void>;
  findConversationLink(studioId: string, externalConversationId: string): Promise<ConversationLink | null>;
  claimOutboundOperation(studioId: string, connectionId: string, externalConversationId: string, idempotencyKey: string): Promise<OutboundClaim>;
  markOutboundSucceeded(studioId: string, operationId: string, externalMessageId: string): Promise<void>;
  markOutboundFailed(studioId: string, operationId: string): Promise<void>;
  markOutboundUnknown(studioId: string, operationId: string): Promise<void>;
}

export interface InboxProviderPort {
  listOpenConversations(connection: MessagingConnection, page: number, signal?: AbortSignal): Promise<ConversationBatch>;
  getMessages(connection: MessagingConnection, externalConversationId: string, before?: string, signal?: AbortSignal): Promise<MessagePage>;
  sendReply(connection: MessagingConnection, externalConversationId: string, content: string, signal?: AbortSignal): Promise<{ externalMessageId: string }>;
}

export class MessagingConnectionUnavailableError extends Error {
  readonly code = "MESSAGING_CONNECTION_UNAVAILABLE";
  constructor() { super("Messaging connection unavailable"); this.name = "MessagingConnectionUnavailableError"; }
}
export class ConversationNotFoundError extends Error {
  readonly code = "CONVERSATION_NOT_FOUND";
  constructor() { super("Conversation not found"); this.name = "ConversationNotFoundError"; }
}
export class ReplyAlreadyInProgressError extends Error {
  readonly code = "REPLY_ALREADY_IN_PROGRESS";
  constructor() { super("Reply already in progress"); this.name = "ReplyAlreadyInProgressError"; }
}
export class ReplyOutcomeUnknownError extends Error {
  readonly code = "REPLY_OUTCOME_UNKNOWN";
  constructor() { super("Reply outcome unknown"); this.name = "ReplyOutcomeUnknownError"; }
}
export class MessagingProviderUnavailableError extends Error {
  readonly code = "MESSAGING_PROVIDER_UNAVAILABLE";
  constructor() { super("Messaging provider unavailable"); this.name = "MessagingProviderUnavailableError"; }
}
export class MessagingProviderRejectedError extends Error {
  readonly code = "MESSAGING_PROVIDER_REJECTED";
  constructor() { super("Messaging provider rejected request"); this.name = "MessagingProviderRejectedError"; }
}
export class MessagingProviderOutcomeUnknownError extends Error {
  readonly code = "MESSAGING_PROVIDER_OUTCOME_UNKNOWN";
  constructor() { super("Messaging provider outcome unknown"); this.name = "MessagingProviderOutcomeUnknownError"; }
}

export function createMessagingService(repository: MessagingRepositoryPort, providerSource: InboxProviderPort | (() => InboxProviderPort)) {
  const provider = (): InboxProviderPort => typeof providerSource === "function" ? providerSource() : providerSource;

  async function activeConnection(studioId: string): Promise<MessagingConnection> {
    const connection = await repository.findActiveConnection(studioId);
    if (!connection) throw new MessagingConnectionUnavailableError();
    return connection;
  }

  async function linkedConnection(studioId: string, externalConversationId: string): Promise<{ connection: MessagingConnection; link: ConversationLink }> {
    const link = await repository.findConversationLink(studioId, externalConversationId);
    if (!link) throw new ConversationNotFoundError();
    const connection = await activeConnection(studioId);
    if (connection.id !== link.connectionId) throw new ConversationNotFoundError();
    return { connection, link };
  }

  return {
    async listOpenConversations(studioId: string, rawPage: number | string = 1, signal?: AbortSignal): Promise<ConversationPage> {
      const page = normalizeConversationPage(String(rawPage));
      const connection = await repository.findActiveConnection(studioId);
      if (!connection) return { items: [], page, pageSize: 25, totalCount: 0, previousPage: page > 1 ? page - 1 : null, nextPage: null };
      const conversations = await provider().listOpenConversations(connection, page, signal);
      await repository.upsertConversationLinks(studioId, connection.id, conversations.items.map((item) => item.id));
      return {
        ...conversations, page, pageSize: 25,
        previousPage: page > 1 ? page - 1 : null,
        nextPage: page < 1000 && page * 25 < conversations.totalCount ? page + 1 : null,
      };
    },

    async getConversationMessages(studioId: string, conversationId: string, rawBefore?: string, signal?: AbortSignal): Promise<MessagePage> {
      const externalId = normalizeConversationId(conversationId);
      const before = normalizeMessageBefore(rawBefore);
      const { connection } = await linkedConnection(studioId, externalId);
      return await provider().getMessages(connection, externalId, before, signal);
    },

    async sendConversationReply(studioId: string, conversationId: string, rawContent: string, rawKey: string, signal?: AbortSignal): Promise<{ externalMessageId: string; repeated: boolean }> {
      const content = normalizeReplyText(rawContent);
      const idempotencyKey = normalizeIdempotencyKey(rawKey);
      const externalId = normalizeConversationId(conversationId);
      const { connection } = await linkedConnection(studioId, externalId);
      const claim = await repository.claimOutboundOperation(studioId, connection.id, externalId, idempotencyKey);
      if (claim.kind === "SUCCEEDED") return { externalMessageId: claim.externalMessageId, repeated: true };
      if (claim.kind === "PENDING") throw new ReplyAlreadyInProgressError();
      if (claim.kind === "UNKNOWN") throw new ReplyOutcomeUnknownError();

      try {
        const sent = await provider().sendReply(connection, externalId, content, signal);
        try {
          await repository.markOutboundSucceeded(studioId, claim.operationId, sent.externalMessageId);
        } catch {
          await bestEffortUnknown(repository, studioId, claim.operationId);
          throw new ReplyOutcomeUnknownError();
        }
        return { externalMessageId: sent.externalMessageId, repeated: false };
      } catch (error: unknown) {
        if (error instanceof ReplyOutcomeUnknownError) throw error;
        if (error instanceof MessagingProviderRejectedError) {
          await repository.markOutboundFailed(studioId, claim.operationId);
          throw error;
        }
        await bestEffortUnknown(repository, studioId, claim.operationId);
        throw new ReplyOutcomeUnknownError();
      }
    },
  };
}

async function bestEffortUnknown(repository: MessagingRepositoryPort, studioId: string, operationId: string): Promise<void> {
  try { await repository.markOutboundUnknown(studioId, operationId); } catch { /* remains PENDING and is still non-repeatable */ }
}
