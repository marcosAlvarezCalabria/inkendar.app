import {
  ConversationCannotReplyError,
  ConversationCaseCustomerMismatchError,
  ConversationCaseNotFoundError,
  ConversationCustomerNotFoundError,
  ConversationNotFoundError,
  ConversationProviderUnavailableError,
  InvalidConversationInputError,
  createConversationsService,
  createCustomerCasesService,
} from "@inkendar/application";
import { InvalidCustomerCaseInputError, normalizeExternalConversationId } from "@inkendar/domain";
import {
  type ChatwootConnection,
  ChatwootConnections,
  ChatwootConversationAdapter,
  createSupabaseConversationsRequestAdapter,
  createSupabaseCustomerCasesRequestAdapter,
} from "@inkendar/infrastructure";

import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

export type OwnerConversationsContext = Readonly<{
  conversations: ReturnType<typeof createConversationsService>;
  customerCases: ReturnType<typeof createCustomerCasesService>;
}>;

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  createContext(request: Request, studioId: string): OwnerConversationsContext;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  createContext: (request, studioId) => createOwnerContext(request, studioId, process.env),
};

export function createOwnerConversationsHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const context = dependencies.createContext(request, authorization.access.studioId);
        const selected = new URL(request.url).searchParams.get("conversation");
        const [conversations, customers, cases, thread] = await Promise.all([
          context.conversations.listInbox(authorization.access.studioId),
          context.customerCases.listCustomers(authorization.access.studioId),
          context.customerCases.listTattooCases(authorization.access.studioId),
          selected ? context.conversations.getThread(selected) : Promise.resolve(null),
        ]);
        return Response.json({ conversations, customers, cases, thread }, { headers });
      } catch (error) {
        throw publicError(error, headers);
      }
    },

    async action(request: Request): Promise<Response> {
      if (request.method !== "POST") {
        const headers = privateHeaders();
        headers.set("Allow", "POST");
        return new Response("Solicitud no admitida", { status: 405, headers });
      }
      if (!isTrustedMutationRequest(request)) return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const form = await request.formData();
        const intent = required(form, "intent");
        const conversationId = normalizeExternalConversationId(required(form, "conversationId"));
        const context = dependencies.createContext(request, authorization.access.studioId);
        if (intent === "reply") {
          await context.conversations.reply(authorization.access.studioId, conversationId, required(form, "content"));
        } else if (intent === "link") {
          await context.conversations.link(authorization.access.studioId, { conversationId, customerId: required(form, "customerId"), tattooCaseId: optional(form, "tattooCaseId") });
        } else {
          throw new InvalidConversationInputError("externalId");
        }
        headers.set("Location", `/app/owner/conversations?conversation=${encodeURIComponent(conversationId)}`);
        return new Response(null, { status: 303, headers });
      } catch (error) {
        return publicError(error, headers);
      }
    },
  };
}

export const ownerConversationsHandlers = createOwnerConversationsHandlers();

function createOwnerContext(request: Request, studioId: string, environment: Record<string, string | undefined>): OwnerConversationsContext {
  const connection: ChatwootConnection = new ChatwootConnections(environment.INKENDAR_CHATWOOT_CONNECTIONS_JSON).forStudio(studioId);
  const links = createSupabaseConversationsRequestAdapter(request, environment);
  const customerCasesRepository = createSupabaseCustomerCasesRequestAdapter(request, environment);
  return {
    conversations: createConversationsService({ externalAccountId: connection.accountId, provider: new ChatwootConversationAdapter(connection), links, customerCases: customerCasesRepository, webhooks: links }),
    customerCases: createCustomerCasesService(customerCasesRepository),
  };
}

function required(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new InvalidConversationInputError("externalId");
  return value;
}
function optional(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value !== "string") throw new InvalidConversationInputError("externalId");
  return value;
}
function privateHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}
function publicError(error: unknown, headers: Headers): Response {
  if (error instanceof InvalidConversationInputError || error instanceof InvalidCustomerCaseInputError) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers });
  if (error instanceof ConversationCannotReplyError) return Response.json({ error: "La conversación no admite respuesta." }, { status: 409, headers });
  if (error instanceof ConversationNotFoundError || error instanceof ConversationCustomerNotFoundError || error instanceof ConversationCaseNotFoundError || error instanceof ConversationCaseCustomerMismatchError) return Response.json({ error: "No se encontró el recurso solicitado." }, { status: 404, headers });
  if (error instanceof ConversationProviderUnavailableError) return Response.json({ error: "Las conversaciones no están disponibles temporalmente." }, { status: 503, headers });
  return Response.json({ error: "No se pudo completar la operación." }, { status: 500, headers });
}
