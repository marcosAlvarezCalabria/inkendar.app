import { useRef, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { EmptyState, Notice, StatusBadge, StatusPage, type Tone } from "../ui/feedback.js";
import { Field, SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";
import type { BookingOfferManagement, BookingOfferStatus, BookingOptionStatus } from "@inkendar/application";
import type { Route } from "./+types/owner-offers";
import { ownerBookingOfferHandlers } from "../owner-booking-offers.server.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Ofertas de fechas | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerBookingOfferHandlers.loader(request);
  if (response.status >= 400) {
    throw new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}
export async function action({ request }: Route.ActionArgs) { return ownerBookingOfferHandlers.action(request); }

export type OwnerOffersActionResult = Readonly<{ error?: string; accessUrl?: string; expiresAt?: string }>;
export type OwnerOffersPending = Readonly<
  | { intent: "configure-expiry" }
  | { intent: "create" }
  | { intent: "expire-due" }
  | { intent: "rotate-access"; offerId: string }
>;

export default function OwnerOffers() {
  const data = useLoaderData() as BookingOfferManagement;
  const actionData = useActionData() as OwnerOffersActionResult | undefined;
  const navigation = useNavigation();
  return <OwnerOffersView data={data} actionResult={actionData} pending={getPendingSubmission(navigation.state, navigation.formData)} />;
}

export function OwnerOffersView({ data, actionResult, pending }: Readonly<{
  data: BookingOfferManagement;
  actionResult?: OwnerOffersActionResult | undefined;
  pending?: OwnerOffersPending | undefined;
}>) {
  const canCreate = data.cases.length > 0 && data.artists.length > 0;
  return <OwnerShell title="Ofertas de fechas" description="Preaprueba horarios, controla sus bloqueos provisionales y comparte un único enlace seguro.">
    {actionResult?.error ? <Notice tone="danger" title="No se pudo completar la operación">{actionResult.error}</Notice> : null}
    {actionResult?.accessUrl && actionResult.expiresAt ? <SensitiveAccessLink accessUrl={actionResult.accessUrl} expiresAt={actionResult.expiresAt} /> : null}

    <div className="booking-workspace">
      <section className="shell-panel" aria-labelledby="offer-expiry-title">
        <h2 id="offer-expiry-title">Caducidad del estudio</h2>
        <p>Las ofertas nuevas usan este plazo. El actual es <strong>{formatExpiryHours(data.expiryHours)}</strong>; al vencer, sus bloqueos provisionales pueden liberarse.</p>
        <Form method="post" className="record-form">
          <input type="hidden" name="intent" value="configure-expiry" />
          <Field label="Plazo en horas" hint="Introduce un número entero positivo. El valor por defecto del producto es 24 horas.">
            {(control) => <input {...control} name="expiryHours" type="number" min="1" max="32767" defaultValue={data.expiryHours} required />}
          </Field>
          <SubmitButton pending={pending?.intent === "configure-expiry"} pendingLabel="Guardando plazo…">Guardar plazo</SubmitButton>
        </Form>
      </section>

      <section className="shell-panel" id="new-offer" aria-labelledby="new-offer-title">
        <h2 id="new-offer-title">Nueva oferta preaprobada</h2>
        <p>Envía hasta tres opciones preaprobadas. Escribe cada intervalo en UTC y en una línea independiente. Bloquearlas es provisional: no confirma una cita ni registra señal o pago.</p>
        {canCreate ? <Form method="post" className="record-form">
          <input type="hidden" name="intent" value="create" />
          <label>Caso<select name="tattooCaseId" required><option value="">Selecciona un caso</option>{data.cases.map((item) => <option key={item.id} value={item.id}>{item.summary}</option>)}</select></label>
          <label>Artista<select name="artistProfileId" required><option value="">Selecciona un artista</option>{data.artists.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <Field label="Opciones UTC (inicio,fin; una por línea)" hint="De 1 a 3 intervalos futuros, por ejemplo 2026-10-08T09:00,2026-10-08T10:30.">
            {(control) => <textarea {...control} name="options" placeholder="2026-09-20T09:00,2026-09-20T10:00" maxLength={4096} required />}
          </Field>
          <SubmitButton pending={pending?.intent === "create"} pendingLabel="Creando oferta…">Crear oferta y bloquear</SubmitButton>
        </Form> : <EmptyState title="Necesitas un caso abierto y un artista" action={data.cases.length === 0 ? <Link className="button" to="/app/owner/cases">Ir a casos</Link> : undefined}>
          Las ofertas siempre se vinculan a ambos. Abre primero un caso y comprueba que el estudio tenga un artista disponible.
        </EmptyState>}
      </section>
    </div>

    <section className="shell-panel records offer-list-panel" aria-labelledby="offer-list-title">
      <div className="section-header">
        <div><h2 id="offer-list-title">Ofertas del estudio</h2><p className="section-intro">Cada estado indica qué ocurrió y cuál es el siguiente paso seguro.</p></div>
        <Form method="post">
          <input type="hidden" name="intent" value="expire-due" />
          <SubmitButton className="secondary" pending={pending?.intent === "expire-due"} pendingLabel="Liberando vencidas…">Liberar vencidas</SubmitButton>
        </Form>
      </div>
      {data.offers.length > 0 ? data.offers.map((offer) => {
        const presentation = offerPresentation(offer.status);
        const caseSummary = data.cases.find((item) => item.id === offer.tattooCaseId)?.summary ?? "Caso no disponible";
        const artistName = data.artists.find((item) => item.id === offer.artistProfileId)?.displayName ?? "Artista no disponible";
        return <article className="record-entry offer-entry" key={offer.id} aria-labelledby={`offer-${offer.id}`}>
          <div className="record-head">
            <h3 id={`offer-${offer.id}`}>{caseSummary}</h3>
            <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
          </div>
          <dl className="offer-meta">
            <div><dt>Artista</dt><dd>{artistName}</dd></div>
            <div><dt>Vencimiento</dt><dd><UtcDateTime value={offer.expiresAt} /></dd></div>
          </dl>
          <ul className="offer-options" aria-label={`Opciones de ${caseSummary}`}>
            {offer.options.map((option, index) => {
              const optionPresentation = optionStatusPresentation(option.status);
              return <li key={option.id}>
                <div className="record-head"><strong>Opción {index + 1}</strong><StatusBadge tone={optionPresentation.tone}>{optionPresentation.label}</StatusBadge></div>
                <p><UtcDateTime value={option.startUtc} /> — <UtcDateTime value={option.endUtc} /></p>
              </li>;
            })}
          </ul>
          <p className="offer-next-step"><strong>Siguiente paso:</strong> {presentation.nextStep}</p>
          {offer.status === "OPEN" ? <Form method="post" className="offer-access-action">
            <input type="hidden" name="intent" value="rotate-access" />
            <input type="hidden" name="offerId" value={offer.id} />
            <SubmitButton className="secondary" pending={pending?.intent === "rotate-access" && pending.offerId === offer.id} pendingLabel="Rotando enlace…">Emitir o rotar enlace de lectura</SubmitButton>
          </Form> : null}
        </article>;
      }) : <EmptyState title="Todavía no hay ofertas" action={canCreate ? <a className="button" href="#new-offer">Crear la primera oferta</a> : undefined}>
        {canCreate ? "Crea la primera oferta para bloquear provisionalmente hasta tres horarios." : "Cuando cumplas las precondiciones de caso y artista, podrás crear aquí la primera oferta."}
      </EmptyState>}
    </section>
  </OwnerShell>;
}

export function SensitiveAccessLink({ accessUrl, expiresAt }: Readonly<{ accessUrl: string; expiresAt: string }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "manual">("idle");

  async function copyAccessUrl() {
    setCopyState("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(accessUrl);
      setCopyState("copied");
      return;
    } catch {
      const input = inputRef.current;
      input?.focus();
      input?.select();
      input?.setSelectionRange(0, accessUrl.length);
      try {
        if (document.execCommand?.("copy")) {
          setCopyState("copied");
          return;
        }
      } catch {
        // The selected read-only field remains the manual, no-Clipboard fallback.
      }
      setCopyState("manual");
    }
  }

  return <section className="shell-panel sensitive-access" aria-labelledby="sensitive-access-title">
    <div className="record-head"><h2 id="sensitive-access-title">Enlace sensible · una sola aparición</h2><StatusBadge tone="warning">No se guardará aquí</StatusBadge></div>
    <p>Cópialo ahora y compártelo por un canal seguro. Al rotarlo, el enlace anterior deja de funcionar; el listado no permite recuperarlo.</p>
    <div className="sensitive-link-control">
      <label className="visually-hidden" htmlFor="issued-offer-access">Enlace público recién emitido</label>
      <input ref={inputRef} id="issued-offer-access" className="sensitive-link" value={accessUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
      <button type="button" onClick={copyAccessUrl} disabled={copyState === "copying"}>{copyState === "copying" ? "Copiando…" : "Copiar enlace"}</button>
    </div>
    <p>Vence el <UtcDateTime value={expiresAt} />.</p>
    <p className="copy-feedback" role="status" aria-live="polite">
      {copyState === "copied" ? "Enlace copiado. Ya puedes pegarlo en el canal seguro." : copyState === "manual" ? "No se pudo copiar automáticamente. El enlace está seleccionado; usa el comando de copiar de tu dispositivo." : null}
    </p>
  </section>;
}

export function ErrorBoundary() {
  useRouteError();
  return <StatusPage tone="warning" title="Ofertas no disponibles" action={<Link className="button" to="/app/owner/offers">Reintentar</Link>}>
    No se pudieron cargar las ofertas. Inténtalo de nuevo más tarde.
  </StatusPage>;
}

function UtcDateTime({ value }: Readonly<{ value: string }>) {
  const date = new Date(value);
  const label = Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date)} UTC` : "Fecha no disponible";
  return <time dateTime={value}>{label}</time>;
}

function formatExpiryHours(hours: number): string {
  if (hours < 24) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return `${hours} horas (${days} ${days === 1 ? "día" : "días"}${remainder ? ` y ${remainder} horas` : ""})`;
}

function offerPresentation(status: BookingOfferStatus): Readonly<{ label: string; tone: Tone; nextStep: string }> {
  if (status === "OPEN") return { label: "Abierta", tone: "info", nextStep: "Comparte el enlace seguro; puedes rotarlo mientras la oferta siga abierta." };
  if (status === "SELECTED_PENDING_CONFIRMATION") return { label: "Selección recibida", tone: "pending", nextStep: "Espera a que termine la confirmación antes de comunicar una cita." };
  if (status === "CONFIRMED") return { label: "Confirmada", tone: "success", nextStep: "La cita ya está confirmada; las demás opciones no están disponibles." };
  return { label: "Caducada", tone: "neutral", nextStep: "Los bloqueos se han liberado y los horarios pueden volver a ofrecerse." };
}

function optionStatusPresentation(status: BookingOptionStatus): Readonly<{ label: string; tone: Tone }> {
  if (status === "HELD") return { label: "Bloqueada", tone: "warning" };
  if (status === "SELECTED") return { label: "Seleccionada", tone: "pending" };
  if (status === "CONFIRMED") return { label: "Confirmada", tone: "success" };
  return { label: "Liberada", tone: "neutral" };
}

function getPendingSubmission(state: string, formData: FormData | undefined): OwnerOffersPending | undefined {
  if (state !== "submitting" || !formData) return undefined;
  const intent = formData.get("intent");
  if (intent === "configure-expiry" || intent === "create" || intent === "expire-due") return { intent };
  const offerId = formData.get("offerId");
  return intent === "rotate-access" && typeof offerId === "string" ? { intent, offerId } : undefined;
}
