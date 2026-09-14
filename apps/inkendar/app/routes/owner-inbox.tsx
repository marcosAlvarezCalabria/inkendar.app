import { Link, useLoaderData } from "react-router";
import type { ConversationPage } from "@inkendar/application";
import type { Route } from "./+types/owner-inbox";
import { ownerMessagingHandlers } from "../owner-messaging.server.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Bandeja | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerMessagingHandlers.inboxLoader(request); }

export default function OwnerInbox() {
  const data = useLoaderData() as { conversations: ConversationPage; error?: string };
  return <main className="shell-page">
    <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Bandeja</h1></div><Link to="/app/owner">Volver al panel</Link></header>
    {data.error ? <p className="form-error" role="alert">{data.error}</p> : null}
    <section className="shell-panel" aria-labelledby="conversation-list-title">
      <h2 id="conversation-list-title">Conversaciones abiertas</h2>
      {data.conversations.items.length === 0 ? <p>Todavía no hay conversaciones disponibles.</p> : <ul className="conversation-list">
        {data.conversations.items.map((conversation) => <li key={conversation.id}>
          <Link to={`/app/owner/inbox/${conversation.id}`}><strong>{conversation.title}</strong><span>{conversation.lastMessagePreview ?? "Sin vista previa"}</span>{conversation.unreadCount > 0 ? <span aria-label={`${conversation.unreadCount} sin leer`}>{conversation.unreadCount}</span> : null}</Link>
        </li>)}
      </ul>}
      {data.conversations.previousPage !== null || data.conversations.nextPage !== null ? <nav aria-label="Paginación de conversaciones">
        {data.conversations.previousPage !== null ? <Link to={data.conversations.previousPage === 1 ? "/app/owner/inbox" : `/app/owner/inbox?page=${data.conversations.previousPage}`}>Anterior</Link> : null}
        {data.conversations.nextPage !== null ? <Link to={`/app/owner/inbox?page=${data.conversations.nextPage}`}>Siguiente</Link> : null}
      </nav> : null}
    </section>
  </main>;
}
