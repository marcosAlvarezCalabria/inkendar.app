import type { ConversationImageProviderPort } from "@inkendar/application";
import { normalizeExternalConversationId } from "@inkendar/domain";
import { ChatwootConnections, ChatwootConversationAdapter } from "@inkendar/infrastructure";
import { authHandlers, type AuthorizedRequestAccess } from "./auth.server.js";

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  createContext(request: Request, studioId: string): ConversationImageProviderPort | null;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  createContext: (_request, studioId) => {
    const connection = new ChatwootConnections(process.env.INKENDAR_CHATWOOT_CONNECTIONS_JSON).forStudio(studioId);
    return connection ? new ChatwootConversationAdapter(connection) : null;
  },
};

export function createOwnerConversationImageHandler(dependencies: Dependencies = defaults) {
  return async (request: Request, params: Readonly<{ conversationId: string; messageId: string; attachmentId: string }>): Promise<Response> => {
    const authorization = await dependencies.authorize(request);
    if (authorization instanceof Response) return authorization;
    const headers = privateImageHeaders(authorization.headers);
    if (!trustedRead(request) || (request.method !== "GET" && request.method !== "HEAD")) return unavailable(headers);
    try {
      const conversationId = normalizeExternalConversationId(params.conversationId);
      const messageId = normalizeExternalConversationId(params.messageId);
      const attachmentId = normalizeExternalConversationId(params.attachmentId);
      const context = dependencies.createContext(request, authorization.access.studioId);
      if (!context) return unavailable(headers);
      const image = await context.getImageAttachment(conversationId, messageId, attachmentId, request.signal);
      headers.set("Content-Type", image.mediaType);
      headers.set("Content-Length", String(image.bytes.byteLength));
      return new Response(request.method === "HEAD" ? null : Uint8Array.from(image.bytes).buffer, { headers });
    } catch { return unavailable(headers); }
  };
}

export const ownerConversationImageHandler = createOwnerConversationImageHandler();

function unavailable(headers: Headers): Response { return new Response("Imagen no disponible", { status: 404, headers }); }
function trustedRead(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin" || site === "none";
}
function privateImageHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}
