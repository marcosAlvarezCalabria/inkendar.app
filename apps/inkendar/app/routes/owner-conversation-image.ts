import type { Route } from "./+types/owner-conversation-image";
import { ownerConversationImageHandler } from "../owner-conversation-image.server.js";

export async function loader({ request, params }: Route.LoaderArgs) {
  return ownerConversationImageHandler(request, {
    conversationId: params.conversationId ?? "",
    messageId: params.messageId ?? "",
    attachmentId: params.attachmentId ?? "",
  });
}
