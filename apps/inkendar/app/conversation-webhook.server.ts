import { InvalidConversationWebhookError, createConversationWebhookService, type ConversationWebhookAttemptOutcome, type ConversationWebhookEvent, type ConversationWebhookObservabilityPort, type ConversationWebhookRepositoryPort } from "@inkendar/application";
import { ChatwootConnections, createSupabaseConversationsWebhookAdapter, verifyChatwootWebhook, type ChatwootConnection } from "@inkendar/infrastructure";

type Dependencies = Readonly<{
  connection(connectionId: string): ChatwootConnection;
  verify(input: Readonly<{ connection: ChatwootConnection; rawBody: string; headers: Headers }>): ConversationWebhookEvent;
  repository(): ConversationWebhookRepositoryPort;
  observability(): ConversationWebhookObservabilityPort;
}>;

const MAX_BODY_BYTES = 262_144;

const defaults: Dependencies = {
  connection: (connectionId) => new ChatwootConnections(process.env.INKENDAR_CHATWOOT_CONNECTIONS_JSON).forWebhook(connectionId),
  verify: verifyChatwootWebhook,
  repository: () => createSupabaseConversationsWebhookAdapter(process.env),
  observability: () => createSupabaseConversationsWebhookAdapter(process.env),
};

export function createConversationWebhookHandler(dependencies: Dependencies = defaults) {
  return async (request: Request, connectionId: string): Promise<Response> => {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (request.method !== "POST") return Response.json({ error: "Solicitud no admitida." }, { status: 405, headers });
    const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") return Response.json({ error: "Contenido no admitido." }, { status: 415, headers });
    const contentLength = request.headers.get("Content-Length");
    if (contentLength !== null) {
      const declaredSize = Number(contentLength);
      if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_BODY_BYTES) {
        return Response.json({ error: "Solicitud no válida." }, { status: 413, headers });
      }
    }

    let connection: ChatwootConnection;
    try {
      connection = dependencies.connection(connectionId);
    } catch {
      return Response.json({ error: "Solicitud no autorizada." }, { status: 401, headers });
    }

    const rawBody = await readLimitedBody(request);
    if (rawBody === null) {
      await recordAttemptBestEffort(dependencies, connection.studioId, "request_invalid");
      return Response.json({ error: "Solicitud no válida." }, { status: 413, headers });
    }
    let event: ConversationWebhookEvent;
    try {
      event = dependencies.verify({ connection, rawBody, headers: request.headers });
    } catch (error) {
      await recordAttemptBestEffort(dependencies, connection.studioId, invalidOutcome(error));
      if (error instanceof InvalidConversationWebhookError) return Response.json({ error: "Solicitud no autorizada." }, { status: 401, headers });
      return Response.json({ error: "Solicitud no autorizada." }, { status: 401, headers });
    }

    try {
      const service = createConversationWebhookService({ externalAccountId: connection.accountId, repository: dependencies.repository() });
      const result = await service.ingest(connection.studioId, event);
      return Response.json({ status: result === "ACCEPTED" ? "accepted" : "duplicate" }, { status: result === "ACCEPTED" ? 202 : 200, headers });
    } catch {
      await recordAttemptBestEffort(dependencies, connection.studioId, "persistence_failed");
      return Response.json({ error: "No se pudo registrar la entrega." }, { status: 503, headers });
    }
  };
}

function invalidOutcome(error: unknown): ConversationWebhookAttemptOutcome {
  if (!(error instanceof InvalidConversationWebhookError)) return "schema_invalid";
  if (error.reason === "AUTH_HEADERS_MISSING") return "auth_headers_missing";
  if (error.reason === "AUTH_INVALID") return "auth_invalid";
  if (error.reason === "SIGNATURE_INVALID") return "signature_invalid";
  return "schema_invalid";
}

async function recordAttemptBestEffort(dependencies: Dependencies, studioId: string, outcome: ConversationWebhookAttemptOutcome): Promise<void> {
  try { await dependencies.observability().recordAttempt(studioId, outcome); } catch { /* Observability must not alter the public webhook contract. */ }
}

async function readLimitedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

export const conversationWebhookHandler = createConversationWebhookHandler();
