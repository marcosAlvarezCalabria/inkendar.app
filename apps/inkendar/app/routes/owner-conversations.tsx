import { useState } from "react";
import { Form, isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { ConversationMessage, ConversationPage, ConversationThread, Customer, TattooCase } from "@inkendar/application";

import { ownerConversationsHandlers } from "../owner-conversations.server.js";
import { routeResponseOrThrow } from "../route-response.server.js";
import { AccessDeniedPage, EmptyState, Notice, StatusBadge, StatusPage, type Tone } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";
import type { Route } from "./+types/owner-conversations";

export type OwnerConversationsData = Readonly<{ conversations: ConversationPage; customers: readonly Customer[]; cases: readonly TattooCase[]; thread: ConversationThread | null; idempotencyKey: string | null }>;
type ActionResult = Readonly<{ error?: string; blocked?: boolean }>;
export type ConversationPendingSubmission = Readonly<{ intent: "link" | "reply"; conversationId: string }>;

export function meta(): Route.MetaDescriptors { return [{ title: "Conversaciones | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerConversationsHandlers.loader(request);
  return routeResponseOrThrow(response);
}
export async function action({ request }: Route.ActionArgs) { return ownerConversationsHandlers.action(request); }

export default function OwnerConversations() {
  const data = useLoaderData() as OwnerConversationsData;
  const actionResult = useActionData() as ActionResult | undefined;
  const navigation = useNavigation();
  return <OwnerConversationsView data={data} actionResult={actionResult} pending={getPendingSubmission(navigation.state, navigation.formData)} />;
}

export function OwnerConversationsView({ data, actionResult, pending }: Readonly<{
  data: OwnerConversationsData;
  actionResult?: ActionResult | undefined;
  pending?: ConversationPendingSubmission | undefined;
}>) {
  const selected = data.thread ? data.conversations.items.find((conversation) => conversation.id === data.thread?.id) : undefined;
  const blocked = actionResult?.blocked === true;
  return (
    <OwnerShell title="Conversaciones" description="Revisa, relaciona y responde los mensajes del estudio desde una sola bandeja.">
      {actionResult?.error ? blocked ? (
        <Notice tone="warning" title="El resultado del envío necesita revisión">
          {actionResult.error} No envíes otra respuesta todavía; actualiza el hilo y comprueba si aparece antes de decidir el siguiente paso.
        </Notice>
      ) : <Notice tone="danger" title="No se pudo completar la operación">{actionResult.error}</Notice> : null}
      <div className="conversation-layout" data-has-selection={data.thread ? "true" : "false"}>
        <ConversationInbox data={data} selectedId={data.thread?.id} />
        {data.thread ? <ConversationDetail data={data} selected={selected} pending={pending} replyBlocked={blocked} /> : null}
      </div>
    </OwnerShell>
  );
}

function ConversationInbox({ data, selectedId }: Readonly<{ data: OwnerConversationsData; selectedId?: string | undefined }>) {
  const { conversations, customers, cases } = data;
  const totalPages = Math.max(1, Math.ceil(conversations.totalCount / conversations.pageSize));
  return <section className="shell-panel conversation-inbox" aria-labelledby="conversation-list-title">
    <div className="conversation-section-head"><h2 id="conversation-list-title">Bandeja del estudio</h2><p className="meta-line">{conversations.totalCount} {conversations.totalCount === 1 ? "conversación" : "conversaciones"}</p></div>
    {conversations.items.length === 0 ? <EmptyState title="Todavía no hay conversaciones">Los nuevos mensajes aparecerán aquí cuando alguien escriba al estudio.</EmptyState> : <ol className="conversation-list">
      {conversations.items.map((conversation) => {
        const isSelected = conversation.id === selectedId;
        return <li className="conversation-row" data-selected={isSelected ? "" : undefined} key={conversation.id}>
          <div className="conversation-row-head"><h3><Link to={`?page=${conversations.page}&conversation=${encodeURIComponent(conversation.id)}`} aria-current={isSelected ? "page" : undefined}>{conversation.contactName}</Link></h3>{conversation.unreadCount > 0 ? <StatusBadge tone="info">{conversation.unreadCount} sin leer</StatusBadge> : <span className="conversation-read">Al día</span>}</div>
          <div className="stamp-row" aria-label="Canal y estado"><StatusBadge tone="neutral">{channelLabel(conversation.channel)}</StatusBadge><StatusBadge tone={statusTone(conversation.status)}>{statusLabel(conversation.status)}</StatusBadge></div>
          <ConversationActivity at={conversation.lastActivityAt} />
          <p className="conversation-link-state">{conversationLinkLabel(conversation.link, customers, cases)}</p>
        </li>;
      })}
    </ol>}
    {conversations.totalCount > 0 ? <nav className="conversation-pagination" aria-label="Paginación de conversaciones"><p className="meta-line">Página {conversations.page} de {totalPages}</p><div className="conversation-pagination-actions">{conversations.previousPage !== null ? <Link className="button button-quiet" rel="prev" to={`?page=${conversations.previousPage}`}>Página anterior</Link> : <span aria-hidden="true" />}{conversations.nextPage !== null ? <Link className="button button-quiet" rel="next" to={`?page=${conversations.nextPage}`}>Página siguiente</Link> : null}</div></nav> : null}
  </section>;
}

function ConversationDetail({ data, selected, pending, replyBlocked }: Readonly<{ data: OwnerConversationsData; selected: ConversationPage["items"][number] | undefined; pending?: ConversationPendingSubmission | undefined; replyBlocked: boolean }>) {
  const thread = data.thread;
  if (!thread) return null;
  const contactName = selected?.contactName ?? "la conversación seleccionada";
  const isLinkPending = pending?.intent === "link" && pending.conversationId === thread.id;
  const isReplyPending = pending?.intent === "reply" && pending.conversationId === thread.id;
  return <section className="shell-panel conversation-detail" aria-labelledby="conversation-title">
    <header className="conversation-detail-head">
      <Link className="conversation-back" to={`?page=${data.conversations.page}`}>← Volver a conversaciones</Link>
      <div className="record-head"><h2 id="conversation-title">Conversación con {contactName}</h2>{selected ? <StatusBadge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusBadge> : null}</div>
      {selected ? <p className="meta-line">{channelLabel(selected.channel)} · {selected.unreadCount > 0 ? `${selected.unreadCount} sin leer` : "Al día"}</p> : null}
    </header>
    {thread.before ? <p className="conversation-history"><Link className="button button-quiet" to={`?page=${data.conversations.page}&conversation=${encodeURIComponent(thread.id)}&before=${encodeURIComponent(thread.before)}`}>Cargar mensajes anteriores</Link></p> : null}
    <ConversationMessages conversationId={thread.id} messages={thread.messages} />
    <section className="conversation-operation" aria-labelledby="conversation-link-title">
      <h3 id="conversation-link-title">Vínculo operativo</h3>
      {data.customers.length > 0 ? <Form method="post" className="record-form conversation-form">
        <input type="hidden" name="intent" value="link" /><input type="hidden" name="conversationId" value={thread.id} />
        <label>Cliente <select name="customerId" required defaultValue={selected?.link?.customerId ?? ""}><option value="">Selecciona un cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label>Caso <select name="tattooCaseId" defaultValue={selected?.link?.tattooCaseId ?? ""}><option value="">Sin caso</option>{data.cases.map((tattooCase) => <option key={tattooCase.id} value={tattooCase.id}>{tattooCase.summary}</option>)}</select></label>
        <SubmitButton pending={isLinkPending} pendingLabel="Guardando vínculo…">Guardar vínculo</SubmitButton>
      </Form> : <EmptyState title="Necesitas un cliente" action={<Link className="button" to="/app/owner/customers">Crear cliente</Link>}>Crea el cliente antes de vincular esta conversación.</EmptyState>}
    </section>
    <section className="conversation-operation" aria-labelledby="conversation-reply-title">
      <h3 id="conversation-reply-title">Responder</h3>
      {thread.canReply ? <Form method="post" className="record-form conversation-form conversation-reply-form">
        <input type="hidden" name="intent" value="reply" /><input type="hidden" name="conversationId" value={thread.id} /><input type="hidden" name="idempotencyKey" value={data.idempotencyKey ?? ""} />
        <label>Respuesta <textarea name="content" required maxLength={2000} placeholder="Escribe una respuesta para el cliente" /></label>
        <SubmitButton pending={isReplyPending} pendingLabel="Enviando respuesta…" disabled={replyBlocked}>Enviar respuesta</SubmitButton>
      </Form> : <Notice tone="neutral" title="Respuesta no disponible">Esta conversación no admite respuesta en su estado actual.</Notice>}
    </section>
  </section>;
}

export function ConversationActivity({ at }: { at: string }) { return <p className="meta-line">Última actividad: <time dateTime={at}>{formatConversationDate(at)}</time></p>; }
export function ConversationMessages({ conversationId, messages }: { conversationId: string; messages: readonly ConversationMessage[] }) {
  return messages.length === 0 ? <EmptyState title="No hay mensajes públicos">El hilo no contiene mensajes que se puedan mostrar.</EmptyState> : <ol className="conversation-thread" aria-label="Mensajes públicos">
    {messages.map((message) => <li className="conversation-message" data-direction={message.direction} key={message.id}><article>
      <div className="conversation-message-head"><strong>{message.direction === "incoming" ? "Cliente" : "Estudio"}</strong><time dateTime={message.createdAt}>{formatConversationDate(message.createdAt)}</time></div>
      {message.content ? <p>{message.content}</p> : null}
      {message.attachments?.map((attachment, index) => attachment.kind === "image"
        ? <ConversationImage key={attachment.id} source={`/app/owner/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`} />
        : <AttachmentUnavailable key={`unsupported-${index}`} />)}
    </article></li>)}
  </ol>;
}

export function ConversationImage({ source }: { source: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <AttachmentUnavailable />
    : <img className="conversation-attachment-image" src={source} alt="Imagen adjunta del cliente" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function AttachmentUnavailable() { return <p className="conversation-attachment-placeholder" role="status">Adjunto no disponible</p>; }

export function ConversationUnavailablePage() {
  return <StatusPage tone="warning" title="Conversaciones no disponibles" action={<a className="button" href="/app/owner/conversations">Reintentar carga</a>}>La bandeja del estudio no puede cargarse temporalmente. Tus conversaciones no se han borrado.</StatusPage>;
}
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 403) return <AccessDeniedPage />;
  return <ConversationUnavailablePage />;
}

function getPendingSubmission(state: string, formData: FormData | undefined): ConversationPendingSubmission | undefined {
  if (state !== "submitting" || !formData) return undefined;
  const intent = formData.get("intent");
  const conversationId = formData.get("conversationId");
  return (intent === "link" || intent === "reply") && typeof conversationId === "string" ? { intent, conversationId } : undefined;
}

function channelLabel(channel: ConversationPage["items"][number]["channel"]): string {
  if (channel === "web") return "Web";
  if (channel === "instagram") return "Instagram";
  if (channel === "facebook") return "Facebook";
  return "Canal no disponible";
}

function statusLabel(status: ConversationPage["items"][number]["status"]): string {
  if (status === "open") return "Abierta";
  if (status === "pending") return "Pendiente";
  if (status === "resolved") return "Resuelta";
  return "Pospuesta";
}

function statusTone(status: ConversationPage["items"][number]["status"]): Tone {
  if (status === "open") return "success";
  if (status === "pending" || status === "snoozed") return "pending";
  return "neutral";
}

function conversationLinkLabel(link: ConversationPage["items"][number]["link"], customers: readonly Customer[], cases: readonly TattooCase[]): string {
  if (!link) return "Sin vincular";
  const customer = customers.find((item) => item.id === link.customerId)?.name ?? "Cliente vinculado";
  if (!link.tattooCaseId) return `Cliente: ${customer}`;
  const tattooCase = cases.find((item) => item.id === link.tattooCaseId)?.summary ?? "Caso vinculado";
  return `Cliente: ${customer} · Caso: ${tattooCase}`;
}

function formatConversationDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, rawZone] = match;
  const monthLabel = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"][Number(month) - 1];
  const zone = rawZone === "Z" ? "UTC" : `UTC${rawZone}`;
  return `${Number(day)} ${monthLabel} ${year}, ${hour}:${minute} ${zone}`;
}
