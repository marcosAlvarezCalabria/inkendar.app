import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ConversationMessage } from "@inkendar/application";
import type { Route } from "./+types/owner-conversation";
import { ownerMessagingHandlers } from "../owner-messaging.server.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Conversación | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request, params }: Route.LoaderArgs) { return ownerMessagingHandlers.conversationLoader(request, params.conversationId ?? ""); }
export async function action({ request, params }: Route.ActionArgs) { return ownerMessagingHandlers.replyAction(request, params.conversationId ?? ""); }

export default function OwnerConversation() {
  const data = useLoaderData() as { messages: readonly ConversationMessage[]; before: string | null; idempotencyKey: string };
  const actionData = useActionData() as { error?: string; blocked?: boolean } | undefined;
  return <main className="shell-page">
    <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Conversación</h1></div><Link to="/app/owner/inbox">Volver a la bandeja</Link></header>
    {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
    {data.before !== null ? <p><Link to={`?before=${encodeURIComponent(data.before)}`}>Cargar mensajes anteriores</Link></p> : null}
    <section className="shell-panel message-thread" aria-label="Mensajes">
      {data.messages.length === 0 ? <p>Todavía no hay mensajes de texto.</p> : data.messages.map((message) => <article key={message.id} className={`message ${message.direction === "OUTGOING" ? "message-outgoing" : "message-incoming"}`}>
        <p>{message.content}</p><small>{message.direction === "OUTGOING" ? "Estudio" : "Cliente"}</small>
      </article>)}
    </section>
    <Form method="post" className="shell-panel record-form">
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <label htmlFor="reply">Respuesta</label><textarea id="reply" name="reply" required maxLength={4000} rows={5} />
      <button type="submit" disabled={actionData?.blocked === true}>Enviar respuesta</button>
    </Form>
  </main>;
}
