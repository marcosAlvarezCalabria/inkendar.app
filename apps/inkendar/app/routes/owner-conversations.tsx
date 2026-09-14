import { Form, Link, useActionData, useLoaderData, useRouteError } from "react-router";
import type { ConversationThread, Customer, LinkedConversationSummary, TattooCase } from "@inkendar/application";
import type { Route } from "./+types/owner-conversations";

import { ownerConversationsHandlers } from "../owner-conversations.server.js";

type LoaderData = Readonly<{ conversations: readonly LinkedConversationSummary[]; customers: readonly Customer[]; cases: readonly TattooCase[]; thread: ConversationThread | null }>;

export function meta(): Route.MetaDescriptors { return [{ title: "Conversaciones | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerConversationsHandlers.loader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerConversationsHandlers.action(request); }

export default function OwnerConversations() {
  const data = useLoaderData() as LoaderData;
  const actionData = useActionData() as { error?: string } | undefined;
  const selected = data.thread ? data.conversations.find((conversation) => conversation.id === data.thread?.id) : undefined;
  return (
    <main className="shell-page">
      <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Conversaciones</h1></div><Link to="/app/owner">Volver al panel</Link></header>
      {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
      <section className="records" aria-labelledby="conversation-list-title">
        <h2 id="conversation-list-title">Bandeja del estudio</h2>
        {data.conversations.length === 0 ? <p>Todavía no hay conversaciones.</p> : data.conversations.map((conversation) => (
          <article className="shell-panel" key={conversation.id}>
            <h3><Link to={`?conversation=${encodeURIComponent(conversation.id)}`}>{conversation.contactName}</Link></h3>
            <p>{channelLabel(conversation.channel)} · {conversation.status} · {conversation.unreadCount} sin leer</p>
            <ConversationActivity at={conversation.lastActivityAt} />
            <p>{conversation.link ? `Cliente vinculado${conversation.link.tattooCaseId ? " y caso vinculado" : ""}` : "Sin vincular"}</p>
          </article>
        ))}
      </section>
      {data.thread ? <section className="shell-panel" aria-labelledby="conversation-title">
        <h2 id="conversation-title">Detalle de {selected?.contactName ?? "la conversación"}</h2>
        <div className="records" aria-label="Mensajes públicos">
          {data.thread.messages.length === 0 ? <p>No hay mensajes de texto públicos.</p> : data.thread.messages.map((message) => (
            <article key={message.id}><p><strong>{message.direction === "incoming" ? "Cliente" : "Estudio"}</strong></p><p>{message.content}</p><time dateTime={message.createdAt}>{message.createdAt}</time></article>
          ))}
        </div>
        {data.customers.length > 0 ? <Form method="post" className="record-form">
          <input type="hidden" name="intent" value="link" /><input type="hidden" name="conversationId" value={data.thread.id} />
          <label>Cliente <select name="customerId" required defaultValue={selected?.link?.customerId ?? ""}><option value="">Selecciona un cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label>Caso <select name="tattooCaseId" defaultValue={selected?.link?.tattooCaseId ?? ""}><option value="">Sin caso</option>{data.cases.map((tattooCase) => <option key={tattooCase.id} value={tattooCase.id}>{tattooCase.summary}</option>)}</select></label>
          <button type="submit">Guardar vínculo</button>
        </Form> : <p>Crea un cliente antes de vincular esta conversación.</p>}
        {data.thread.canReply ? <Form method="post" className="record-form">
          <input type="hidden" name="intent" value="reply" /><input type="hidden" name="conversationId" value={data.thread.id} />
          <label>Respuesta <textarea name="content" required maxLength={2000} /></label><button type="submit">Enviar respuesta</button>
        </Form> : <p>Esta conversación no admite respuesta.</p>}
      </section> : null}
    </main>
  );
}

export function ConversationActivity({ at }: { at: string }) {
  return <p>Última actividad: <time dateTime={at}>{at}</time></p>;
}

export function ErrorBoundary() {
  useRouteError();
  return <main className="status-page"><p className="eyebrow">Inkendar</p><h1>Conversaciones no disponibles</h1><p>No se pudo cargar la bandeja del estudio.</p></main>;
}

function channelLabel(channel: LinkedConversationSummary["channel"]): string {
  if (channel === "web") return "Web";
  if (channel === "instagram") return "Instagram";
  if (channel === "facebook") return "Facebook";
  return "Canal";
}
