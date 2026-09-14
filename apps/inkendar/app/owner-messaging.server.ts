import {
  ConversationNotFoundError, InvalidMessagingInputError, MessagingConnectionUnavailableError,
  MessagingProviderRejectedError, MessagingProviderUnavailableError, ReplyAlreadyInProgressError,
  ReplyOutcomeUnknownError, ReplyPreviouslyFailedError, createMessagingService,
} from "@inkendar/application";
import { normalizeConversationId, normalizeConversationPage, normalizeIdempotencyKey, normalizeMessageBefore, normalizeReplyText } from "@inkendar/domain";
import { ChatwootInboxAdapter, createSupabaseMessagingRequestAdapter, loadMessagingProviderConfig } from "@inkendar/infrastructure";
import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

type Authorization = Response | AuthorizedRequestAccess;
type Service = ReturnType<typeof createMessagingService>;
type Dependencies = Readonly<{ authorize(request: Request): Promise<Authorization>; service(request: Request): Service; createKey(): string }>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  service: (request) => {
    return createMessagingService(createSupabaseMessagingRequestAdapter(request, process.env), () => {
      const config = loadMessagingProviderConfig(process.env);
      return new ChatwootInboxAdapter(config.baseUrl, config.resolver);
    });
  },
  createKey: () => crypto.randomUUID(),
};

export function createOwnerMessagingHandlers(dependencies: Dependencies = defaults) {
  return {
    async inboxLoader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const page = requestPage(request);
        const conversations = await dependencies.service(request).listOpenConversations(authorization.access.studioId, page, request.signal);
        return Response.json({ conversations }, { headers });
      } catch (error: unknown) {
        if (error instanceof InvalidMessagingInputError) return publicError(error, headers);
        return Response.json({ conversations: emptyConversationPage(), error: "No se pudo cargar la bandeja." }, { status: 502, headers });
      }
    },

    async conversationLoader(request: Request, conversationId: string): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const before = requestBefore(request);
        const messagePage = await dependencies.service(request).getConversationMessages(authorization.access.studioId, conversationId, before, request.signal);
        return Response.json({ conversationId, messages: messagePage.items, before: messagePage.before, idempotencyKey: dependencies.createKey() }, { headers });
      } catch (error: unknown) { return publicError(error, headers); }
    },

    async replyAction(request: Request, conversationId: string): Promise<Response> {
      if (!isTrustedMutationRequest(request)) return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const form = await request.formData();
        const reply = normalizeReplyText(required(form, "reply"));
        const idempotencyKey = normalizeIdempotencyKey(required(form, "idempotencyKey"));
        const normalizedConversationId = normalizeConversationId(conversationId);
        await dependencies.service(request).sendConversationReply(
          authorization.access.studioId, normalizedConversationId, reply, idempotencyKey, request.signal,
        );
        headers.set("Location", `/app/owner/inbox/${normalizedConversationId}`);
        return new Response(null, { status: 303, headers });
      } catch (error: unknown) { return publicError(error, headers); }
    },
  };
}

export const ownerMessagingHandlers = createOwnerMessagingHandlers();
function required(form: FormData, field: string): string { const value = form.get(field); if (typeof value !== "string") throw new InvalidMessagingInputError("reply"); return value; }
function privateHeaders(source?: Headers): Headers { const headers = new Headers(source); headers.set("Cache-Control", "private, no-store"); return headers; }
function requestPage(request: Request): number {
  const values = new URL(request.url).searchParams.getAll("page");
  if (values.length > 1) throw new InvalidMessagingInputError("page");
  return normalizeConversationPage(values[0] ?? null);
}
function requestBefore(request: Request): string | undefined {
  const search = new URL(request.url).searchParams;
  const values = search.getAll("before");
  if (search.has("after") || values.length > 1) throw new InvalidMessagingInputError("before");
  return normalizeMessageBefore(values[0] ?? null);
}
function emptyConversationPage() {
  return { items: [], page: 1, pageSize: 25, totalCount: 0, previousPage: null, nextPage: null };
}
function publicError(error: unknown, headers: Headers): Response {
  if (error instanceof InvalidMessagingInputError) return Response.json({ error: "Revisa los datos solicitados." }, { status: 400, headers });
  if (error instanceof ConversationNotFoundError) return Response.json({ error: "No se encontró la conversación." }, { status: 404, headers });
  if (error instanceof ReplyAlreadyInProgressError) return Response.json({ error: "La respuesta ya se está enviando." }, { status: 409, headers });
  if (error instanceof ReplyOutcomeUnknownError) return Response.json({ error: "No se pudo confirmar el envío. Actualiza la conversación antes de responder de nuevo.", blocked: true }, { status: 409, headers });
  if (error instanceof ReplyPreviouslyFailedError) return Response.json({ error: "La respuesta anterior no se envió. Actualiza la conversación antes de volver a responder.", blocked: true }, { status: 409, headers });
  if (error instanceof MessagingConnectionUnavailableError) return Response.json({ error: "No se pudo completar la operación." }, { status: 503, headers });
  if (error instanceof MessagingProviderUnavailableError || error instanceof MessagingProviderRejectedError) {
    return Response.json({ error: "No se pudo completar la operación." }, { status: 502, headers });
  }
  return Response.json({ error: "No se pudo completar la operación." }, { status: 500, headers });
}
