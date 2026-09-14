import {
  normalizeConversationPage,
  normalizeConversationReply,
  normalizeExternalConversationId,
  normalizeIdempotencyKey,
  normalizeMessageBefore,
  normalizeResourceId,
} from "@inkendar/domain";

export { InvalidConversationInputError } from "@inkendar/domain";

export type ConversationStatus = "open" | "pending" | "resolved" | "snoozed";
export type ConversationChannel = "web" | "instagram" | "facebook" | "unknown";
export type MessageDirection = "incoming" | "outgoing";
export type ConversationSummary = Readonly<{ id: string; inboxId: string; status: ConversationStatus; channel: ConversationChannel; contactName: string; unreadCount: number; lastActivityAt: string; canReply: boolean }>;
export type ConversationMessage = Readonly<{ id: string; direction: MessageDirection; content: string; createdAt: string }>;
export type ConversationThread = Readonly<{ id: string; inboxId: string; canReply: boolean; messages: readonly ConversationMessage[]; before: string | null }>;
export type ConversationBatch = Readonly<{ items: readonly ConversationSummary[]; totalCount: number }>;
export type ConversationPage = Readonly<{ items: readonly LinkedConversationSummary[]; page: number; pageSize: 25; totalCount: number; previousPage: number | null; nextPage: number | null }>;
export type ConversationLink = Readonly<{ id: string; studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null; lastExternalMessageId: string | null; lastActivityAt: string | null }>;
export type LinkedConversationSummary = ConversationSummary & Readonly<{ link: ConversationLink | null }>;
export type ConversationWebhookEvent = Readonly<{ deliveryId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; externalMessageId: string; occurredAt: string }>;

export type OutboundClaim =
  | Readonly<{ kind: "CLAIMED"; operationId: string }>
  | Readonly<{ kind: "SUCCEEDED"; externalMessageId: string }>
  | Readonly<{ kind: "PENDING" }>
  | Readonly<{ kind: "FAILED" }>
  | Readonly<{ kind: "UNKNOWN" }>;

export interface ConversationProviderPort {
  listConversations(page: number, signal?: AbortSignal): Promise<ConversationBatch>;
  getConversation(conversationId: string, before?: string, signal?: AbortSignal): Promise<ConversationThread>;
  sendReply(conversationId: string, content: string, signal?: AbortSignal): Promise<Readonly<{ externalMessageId: string }>>;
}
export interface ConversationLinksRepositoryPort {
  listLinks(studioId: string, externalAccountId: string): Promise<readonly ConversationLink[]>;
  saveLink(input: Readonly<{ studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null }>): Promise<ConversationLink>;
}
export interface ConversationOutboundRepositoryPort {
  claim(studioId: string, externalAccountId: string, externalConversationId: string, idempotencyKey: string): Promise<OutboundClaim>;
  markSucceeded(studioId: string, operationId: string, externalMessageId: string): Promise<void>;
  markFailed(studioId: string, operationId: string): Promise<void>;
  markUnknown(studioId: string, operationId: string): Promise<void>;
}
export interface CustomerCaseLookupPort {
  findCustomer(studioId: string, id: string): Promise<Readonly<{ id: string; studioId: string }> | null>;
  findTattooCase(studioId: string, id: string): Promise<Readonly<{ id: string; studioId: string; customerId: string }> | null>;
}
export type WebhookIngestionResult = "ACCEPTED" | "DUPLICATE";
export interface ConversationWebhookRepositoryPort {
  record(studioId: string, event: ConversationWebhookEvent): Promise<WebhookIngestionResult>;
}

export class ConversationNotFoundError extends Error {
  readonly code = "CONVERSATION_NOT_FOUND";
  constructor() { super("The conversation was not found"); this.name = "ConversationNotFoundError"; }
}
export class ConversationCannotReplyError extends Error {
  readonly code = "CONVERSATION_CANNOT_REPLY";
  constructor() { super("The conversation cannot be replied to"); this.name = "ConversationCannotReplyError"; }
}
export class ConversationCustomerNotFoundError extends Error {
  readonly code = "CONVERSATION_CUSTOMER_NOT_FOUND";
  constructor() { super("The conversation customer was not found"); this.name = "ConversationCustomerNotFoundError"; }
}
export class ConversationCaseNotFoundError extends Error {
  readonly code = "CONVERSATION_CASE_NOT_FOUND";
  constructor() { super("The conversation case was not found"); this.name = "ConversationCaseNotFoundError"; }
}
export class ConversationCaseCustomerMismatchError extends Error {
  readonly code = "CONVERSATION_CASE_CUSTOMER_MISMATCH";
  constructor() { super("The conversation case does not belong to the customer"); this.name = "ConversationCaseCustomerMismatchError"; }
}
export class ConversationProviderUnavailableError extends Error {
  readonly code = "CONVERSATION_PROVIDER_UNAVAILABLE";
  constructor() { super("The conversation provider is unavailable"); this.name = "ConversationProviderUnavailableError"; }
}
export class ConversationProviderRejectedError extends Error {
  readonly code = "CONVERSATION_PROVIDER_REJECTED";
  constructor() { super("The conversation provider rejected the operation"); this.name = "ConversationProviderRejectedError"; }
}
export class ReplyAlreadyInProgressError extends Error {
  readonly code = "REPLY_ALREADY_IN_PROGRESS";
  constructor() { super("Reply already in progress"); this.name = "ReplyAlreadyInProgressError"; }
}
export class ReplyOutcomeUnknownError extends Error {
  readonly code = "REPLY_OUTCOME_UNKNOWN";
  constructor() { super("Reply outcome unknown"); this.name = "ReplyOutcomeUnknownError"; }
}
export class ReplyPreviouslyFailedError extends Error {
  readonly code = "REPLY_PREVIOUSLY_FAILED";
  constructor() { super("Reply previously failed"); this.name = "ReplyPreviouslyFailedError"; }
}
export class InvalidConversationWebhookError extends Error {
  readonly code = "INVALID_CONVERSATION_WEBHOOK";
  constructor() { super("The conversation webhook is invalid"); this.name = "InvalidConversationWebhookError"; }
}

type Dependencies = Readonly<{
  externalAccountId: string;
  provider: ConversationProviderPort;
  links: ConversationLinksRepositoryPort;
  outbound: ConversationOutboundRepositoryPort;
  customerCases: CustomerCaseLookupPort;
  webhooks: ConversationWebhookRepositoryPort;
}>;

export function createConversationsService(dependencies: Dependencies) {
  const externalAccountId = normalizeExternalConversationId(dependencies.externalAccountId);
  return {
    async listInbox(studioId: string, rawPage: number | string = 1, signal?: AbortSignal): Promise<ConversationPage> {
      const page = normalizeConversationPage(String(rawPage));
      const [batch, links] = await Promise.all([
        dependencies.provider.listConversations(page, signal),
        dependencies.links.listLinks(studioId, externalAccountId),
      ]);
      const byConversation = new Map(links.map((link) => [link.externalConversationId, link]));
      return {
        items: batch.items.map((conversation) => ({ ...conversation, link: byConversation.get(conversation.id) ?? null })),
        page,
        pageSize: 25,
        totalCount: batch.totalCount,
        previousPage: page > 1 ? page - 1 : null,
        nextPage: page < 1_000 && page * 25 < batch.totalCount ? page + 1 : null,
      };
    },
    getThread(conversationId: string, rawBefore?: string, signal?: AbortSignal): Promise<ConversationThread> {
      return dependencies.provider.getConversation(
        normalizeExternalConversationId(conversationId),
        normalizeMessageBefore(rawBefore),
        signal,
      );
    },
    async reply(studioId: string, conversationId: string, content: string, rawKey: string, signal?: AbortSignal): Promise<{ externalMessageId: string; repeated: boolean }> {
      const normalizedId = normalizeExternalConversationId(conversationId);
      const normalizedContent = normalizeConversationReply(content);
      const idempotencyKey = normalizeIdempotencyKey(rawKey);
      const claim = await dependencies.outbound.claim(studioId, externalAccountId, normalizedId, idempotencyKey);
      if (claim.kind === "SUCCEEDED") return { externalMessageId: claim.externalMessageId, repeated: true };
      if (claim.kind === "PENDING") throw new ReplyAlreadyInProgressError();
      if (claim.kind === "FAILED") throw new ReplyPreviouslyFailedError();
      if (claim.kind === "UNKNOWN") throw new ReplyOutcomeUnknownError();

      let thread: ConversationThread;
      try {
        thread = await dependencies.provider.getConversation(normalizedId, undefined, signal);
        if (!thread.canReply) throw new ConversationCannotReplyError();
      } catch (error) {
        await dependencies.outbound.markFailed(studioId, claim.operationId);
        throw error;
      }

      try {
        const sent = await dependencies.provider.sendReply(normalizedId, normalizedContent, signal);
        try {
          await dependencies.outbound.markSucceeded(studioId, claim.operationId, sent.externalMessageId);
        } catch {
          await bestEffortUnknown(dependencies.outbound, studioId, claim.operationId);
          throw new ReplyOutcomeUnknownError();
        }
        return { externalMessageId: sent.externalMessageId, repeated: false };
      } catch (error) {
        if (error instanceof ReplyOutcomeUnknownError) throw error;
        if (error instanceof ConversationProviderRejectedError || error instanceof ConversationNotFoundError) {
          await dependencies.outbound.markFailed(studioId, claim.operationId);
          throw error;
        }
        await bestEffortUnknown(dependencies.outbound, studioId, claim.operationId);
        throw new ReplyOutcomeUnknownError();
      }
    },
    async link(studioId: string, input: Readonly<{ conversationId: string; customerId: string; tattooCaseId?: string | undefined }>): Promise<ConversationLink> {
      const conversationId = normalizeExternalConversationId(input.conversationId);
      const customerId = normalizeResourceId("customerId", input.customerId);
      const customer = await dependencies.customerCases.findCustomer(studioId, customerId);
      if (!customer || customer.id !== customerId || customer.studioId !== studioId) throw new ConversationCustomerNotFoundError();
      let tattooCaseId: string | null = null;
      if (input.tattooCaseId !== undefined && input.tattooCaseId.trim().length > 0) {
        tattooCaseId = normalizeResourceId("id", input.tattooCaseId);
        const tattooCase = await dependencies.customerCases.findTattooCase(studioId, tattooCaseId);
        if (!tattooCase || tattooCase.id !== tattooCaseId || tattooCase.studioId !== studioId) throw new ConversationCaseNotFoundError();
        if (tattooCase.customerId !== customerId) throw new ConversationCaseCustomerMismatchError();
      }
      const thread = await dependencies.provider.getConversation(conversationId, undefined, undefined);
      return dependencies.links.saveLink({ studioId, externalAccountId, externalInboxId: thread.inboxId, externalConversationId: conversationId, customerId, tattooCaseId });
    },
    async ingest(studioId: string, event: ConversationWebhookEvent): Promise<WebhookIngestionResult> {
      if (normalizeExternalConversationId(event.externalAccountId) !== externalAccountId) throw new InvalidConversationWebhookError();
      return dependencies.webhooks.record(studioId, event);
    },
  };
}

export function createConversationWebhookService(dependencies: Readonly<{ externalAccountId: string; repository: ConversationWebhookRepositoryPort }>) {
  const externalAccountId = normalizeExternalConversationId(dependencies.externalAccountId);
  return { async ingest(studioId: string, event: ConversationWebhookEvent): Promise<WebhookIngestionResult> {
    if (normalizeExternalConversationId(event.externalAccountId) !== externalAccountId) throw new InvalidConversationWebhookError();
    return dependencies.repository.record(studioId, event);
  } };
}

async function bestEffortUnknown(repository: ConversationOutboundRepositoryPort, studioId: string, operationId: string): Promise<void> {
  try { await repository.markUnknown(studioId, operationId); } catch { /* PENDING also blocks automatic replay. */ }
}
