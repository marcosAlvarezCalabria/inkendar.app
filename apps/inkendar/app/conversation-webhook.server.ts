import { ConversationProviderUnavailableError, InvalidConversationWebhookError, createConversationWebhookService, type ConversationWebhookEvent, type ConversationWebhookRepositoryPort } from "@inkendar/application";
import { ChatwootConnections, createSupabaseConversationsWebhookAdapter, verifyChatwootWebhook, type ChatwootConnection } from "@inkendar/infrastructure";

type Dependencies = Readonly<{
  connection(connectionId: string): ChatwootConnection;
  verify(input: Readonly<{ connection: ChatwootConnection; rawBody: string; headers: Headers }>): ConversationWebhookEvent;
  repository(): ConversationWebhookRepositoryPort;
}>;

const defaults: Dependencies = {
  connection: (connectionId) => new ChatwootConnections(process.env.INKENDAR_CHATWOOT_CONNECTIONS_JSON).forWebhook(connectionId),
  verify: verifyChatwootWebhook,
  repository: () => createSupabaseConversationsWebhookAdapter(process.env),
};

export function createConversationWebhookHandler(dependencies: Dependencies = defaults) {
  return async (request: Request, connectionId: string): Promise<Response> => {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (request.method !== "POST") return Response.json({ error: "Solicitud no admitida." }, { status: 405, headers });
    if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ error: "Contenido no admitido." }, { status: 415, headers });
    const declaredSize = Number(request.headers.get("Content-Length") ?? "0");
    if (!Number.isFinite(declaredSize) || declaredSize > 262_144) return Response.json({ error: "Solicitud no válida." }, { status: 413, headers });

    let connection: ChatwootConnection;
    try {
      connection = dependencies.connection(connectionId);
    } catch (error) {
      if (error instanceof ConversationProviderUnavailableError) return Response.json({ error: "Recurso no encontrado." }, { status: 404, headers });
      return Response.json({ error: "Recurso no encontrado." }, { status: 404, headers });
    }

    const rawBody = await request.text();
    let event: ConversationWebhookEvent;
    try {
      event = dependencies.verify({ connection, rawBody, headers: request.headers });
    } catch (error) {
      if (error instanceof InvalidConversationWebhookError) return Response.json({ error: "Solicitud no autorizada." }, { status: 401, headers });
      return Response.json({ error: "Solicitud no autorizada." }, { status: 401, headers });
    }

    try {
      const service = createConversationWebhookService({ externalAccountId: connection.accountId, repository: dependencies.repository() });
      const result = await service.ingest(connection.studioId, event);
      return Response.json({ status: result === "ACCEPTED" ? "accepted" : "duplicate" }, { status: result === "ACCEPTED" ? 202 : 200, headers });
    } catch {
      return Response.json({ error: "No se pudo registrar la entrega." }, { status: 503, headers });
    }
  };
}

export const conversationWebhookHandler = createConversationWebhookHandler();
