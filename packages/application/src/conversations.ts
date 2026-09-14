import { normalizeConversationReply, normalizeExternalConversationId, normalizeResourceId } from "@inkendar/domain";

export { InvalidConversationInputError } from "@inkendar/domain";

export type ConversationStatus = "open" | "pending" | "resolved" | "snoozed";
export type ConversationChannel = "web" | "instagram" | "facebook" | "unknown";
export type MessageDirection = "incoming" | "outgoing";
export type ConversationSummary = Readonly<{ id: string; inboxId: string; status: ConversationStatus; channel: ConversationChannel; contactName: string; unreadCount: number; lastActivityAt: string; canReply: boolean }>;
export type ConversationMessage = Readonly<{ id: string; direction: MessageDirection; content: string; createdAt: string }>;
export type ConversationThread = Readonly<{ id: string; inboxId: string; canReply: boolean; messages: readonly ConversationMessage[] }>;
export type ConversationLink = Readonly<{ id: string; studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null; lastExternalMessageId: string | null; lastActivityAt: string | null }>;
export type LinkedConversationSummary = ConversationSummary & Readonly<{ link: ConversationLink | null }>;
export type ConversationWebhookEvent = Readonly<{ deliveryId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; externalMessageId: string; occurredAt: string }>;

export interface ConversationProviderPort {
  listConversations(): Promise<readonly ConversationSummary[]>;
  getConversation(conversationId: string): Promise<ConversationThread>;
  sendReply(conversationId: string, content: string): Promise<void>;
}

export interface ConversationLinksRepositoryPort {
  listLinks(studioId: string, externalAccountId: string): Promise<readonly ConversationLink[]>;
  saveLink(input: Readonly<{ studioId: string; externalAccountId: string; externalInboxId: string; externalConversationId: string; customerId: string; tattooCaseId: string | null }>): Promise<ConversationLink>;
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
export class InvalidConversationWebhookError extends Error {
  readonly code = "INVALID_CONVERSATION_WEBHOOK";
  constructor() { super("The conversation webhook is invalid"); this.name = "InvalidConversationWebhookError"; }
}

type Dependencies = Readonly<{ externalAccountId: string; provider: ConversationProviderPort; links: ConversationLinksRepositoryPort; customerCases: CustomerCaseLookupPort; webhooks: ConversationWebhookRepositoryPort }>;

export function createConversationsService(dependencies: Dependencies) {
  const externalAccountId = normalizeExternalConversationId(dependencies.externalAccountId);
  return {
    async listInbox(studioId: string): Promise<readonly LinkedConversationSummary[]> {
      const [conversations, links] = await Promise.all([dependencies.provider.listConversations(), dependencies.links.listLinks(studioId, externalAccountId)]);
      const byConversation = new Map(links.map((link) => [link.externalConversationId, link]));
      return conversations.map((conversation) => ({ ...conversation, link: byConversation.get(conversation.id) ?? null }));
    },
    getThread(conversationId: string): Promise<ConversationThread> {
      return dependencies.provider.getConversation(normalizeExternalConversationId(conversationId));
    },
    async reply(_studioId: string, conversationId: string, content: string): Promise<void> {
      const normalizedId = normalizeExternalConversationId(conversationId);
      const thread = await dependencies.provider.getConversation(normalizedId);
      if (!thread.canReply) throw new ConversationCannotReplyError();
      await dependencies.provider.sendReply(normalizedId, normalizeConversationReply(content));
    },
    async link(studioId: string, input: Readonly<{ conversationId: string; customerId: string; tattooCaseId?: string | undefined }>): Promise<ConversationLink> {
      const conversationId = normalizeExternalConversationId(input.conversationId);
      const customerId = normalizeResourceId("customerId", input.customerId);
      if (!(await dependencies.customerCases.findCustomer(studioId, customerId))) throw new ConversationCustomerNotFoundError();
      let tattooCaseId: string | null = null;
      if (input.tattooCaseId !== undefined && input.tattooCaseId.trim().length > 0) {
        tattooCaseId = normalizeResourceId("id", input.tattooCaseId);
        const tattooCase = await dependencies.customerCases.findTattooCase(studioId, tattooCaseId);
        if (!tattooCase) throw new ConversationCaseNotFoundError();
        if (tattooCase.customerId !== customerId) throw new ConversationCaseCustomerMismatchError();
      }
      const thread = await dependencies.provider.getConversation(conversationId);
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
