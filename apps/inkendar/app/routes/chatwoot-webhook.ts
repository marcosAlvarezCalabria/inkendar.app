import type { Route } from "./+types/chatwoot-webhook";
import { conversationWebhookHandler } from "../conversation-webhook.server.js";

export async function action({ request, params }: Route.ActionArgs) {
  if (!params.connectionId) return Response.json({ error: "Recurso no encontrado." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return conversationWebhookHandler(request, params.connectionId);
}

export function loader() {
  return Response.json({ error: "Solicitud no admitida." }, { status: 405, headers: { "Cache-Control": "no-store" } });
}
