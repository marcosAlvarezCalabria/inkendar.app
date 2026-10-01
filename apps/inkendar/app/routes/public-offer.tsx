import { Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect, useRef } from "react";
import type { FormEvent } from "react";
import type { PublicBookingOfferView as PublicBookingOfferData } from "@inkendar/application";
import type { Route } from "./+types/public-offer";
import { publicBookingOfferHandlers, publicBookingOfferHeaders } from "../public-booking-offer.server.js";
import { Notice } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { PublicDateTime, PublicHeading, PublicInterval, PublicMeta, publicTimeZone } from "../ui/public-booking.js";
import { PublicLinkShell } from "../ui/shells.js";

type ConfirmationReason = "CONFLICT" | "REVIEW_REQUIRED" | "RECONNECT" | "RETRY";
type PublicOfferActionResult = Readonly<{ state?: "CONFIRMED" | "SELECTION_PENDING_CONFIRMATION"; confirmedAt?: string; reason?: ConfirmationReason }>;

export function meta(): Route.MetaDescriptors { return [{ title: "Opciones de fecha | Inkendar" }, { name: "robots", content: "noindex,nofollow" }, { name: "referrer", content: "no-referrer" }]; }
export function headers() { return Object.fromEntries(publicBookingOfferHeaders()); }
export async function loader({ request, params }: Route.LoaderArgs) {
  const response = await publicBookingOfferHandlers.loader(request, params.token);
  if (!response.ok) {
    const status = response.status === 503 ? 503 : 404;
    throw new Response(status === 503 ? "No podemos consultar esta oferta temporalmente." : "Esta oferta no está disponible.", { status, headers: publicBookingOfferHeaders() });
  }
  return response;
}
export async function action({ request, params }: Route.ActionArgs) {
  const response = await publicBookingOfferHandlers.action(request, params.token);
  if (response.status === 404) throw new Response("Esta oferta no está disponible.", { status: 404, headers: publicBookingOfferHeaders() });
  return response;
}

export default function PublicOffer() {
  const data = useLoaderData() as PublicBookingOfferData;
  const actionResult = useActionData() as PublicOfferActionResult | undefined;
  const navigation = useNavigation();
  const submitting = useRef(false);
  const pendingSelector = navigation.state === "submitting" ? formValue(navigation.formData, "selector") : null;
  const confirmationPending = navigation.state === "submitting" && formValue(navigation.formData, "intent") === "confirm";
  useEffect(() => { if (navigation.state === "idle") submitting.current = false; }, [navigation.state]);
  function beginSubmission(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) { event.preventDefault(); return; }
    submitting.current = true;
  }
  return <PublicLinkShell><PublicOfferView data={data} actionResult={actionResult} pendingSelector={pendingSelector} confirmationPending={confirmationPending} onSubmit={beginSubmission} /></PublicLinkShell>;
}

export function PublicOfferView({ data, actionResult, pendingSelector = null, confirmationPending = false, onSubmit }: Readonly<{
  data: PublicBookingOfferData;
  actionResult?: PublicOfferActionResult | undefined;
  pendingSelector?: string | null;
  confirmationPending?: boolean;
  onSubmit?: ((event: FormEvent<HTMLFormElement>) => void) | undefined;
}>) {
  if (data.state === "OPEN") {
    const zone = publicTimeZone(data.timeZone);
    return <>
      <PublicHeading title="Opciones reservadas provisionalmente" label="Opciones disponibles" tone="info" />
      <p className="public-summary">{data.artistDisplayName} ha apartado estas fechas para que elijas la que mejor te encaje.</p>
      <PublicMeta timeZone={zone} expiresAt={data.expiresAt} />
      <Notice tone="warning" title="Aún no es una cita confirmada"><p>Las opciones están bloqueadas solo de forma temporal. Todavía requieren confirmación; al elegir una, Inkendar intentará confirmarla con el calendario.</p></Notice>
      <ol className="public-choice-list" aria-label="Opciones de fecha">{data.options.map((option) => {
        const pending = pendingSelector === option.selector;
        return <li key={option.selector}><Form method="post" className="slot-choice" onSubmit={onSubmit}>
          <input type="hidden" name="selector" value={option.selector} />
          <PublicInterval startUtc={option.startUtc} endUtc={option.endUtc} timeZone={zone} />
          <SubmitButton pending={pending} pendingLabel="Eligiendo…">Elegir esta opción</SubmitButton>
        </Form></li>;
      })}</ol>
    </>;
  }
  if (data.state === "CONFIRMED") {
    const zone = publicTimeZone(data.timeZone);
    return <>
      <PublicHeading title="Cita confirmada" label="Confirmada" tone="success" />
      <p className="public-summary">La cita con {data.artistDisplayName} ya está confirmada en el calendario.</p>
      <PublicMeta timeZone={zone} />
      {data.options[0] ? <PublicInterval startUtc={data.options[0].startUtc} endUtc={data.options[0].endUtc} timeZone={zone} /> : null}
      <p className="public-footnote">Confirmación registrada el <PublicDateTime value={data.confirmedAt} timeZone={zone} />.</p>
    </>;
  }
  const recovery = confirmationRecovery(actionResult?.reason);
  const zone = publicTimeZone(data.timeZone);
  return <>
    <PublicHeading title="Selección recibida" label="Pendiente de confirmación" tone="pending" />
    <p className="public-summary">Has elegido una opción con {data.artistDisplayName}, pero todavía no podemos afirmar que la cita esté confirmada. La confirmación sigue pendiente. Puedes reintentarla con seguridad.</p>
    <PublicMeta timeZone={zone} />
    {data.options[0] ? <PublicInterval startUtc={data.options[0].startUtc} endUtc={data.options[0].endUtc} timeZone={zone} /> : null}
    <Notice tone={recovery.tone} title={recovery.title}><p>{recovery.message}</p></Notice>
    <Form method="post" className="public-retry-form" onSubmit={onSubmit}><input type="hidden" name="intent" value="confirm" /><SubmitButton pending={confirmationPending} pendingLabel="Comprobando…">{recovery.action}</SubmitButton></Form>
  </>;
}

function confirmationRecovery(reason: ConfirmationReason | undefined): Readonly<{ title: string; message: string; action: string; tone: "warning" | "danger" }> {
  if (reason === "CONFLICT") return { title: "El horario requiere revisión", message: "El horario ya no está libre. El horario requiere revisión del estudio. Volver a comprobar no crea una segunda cita.", action: "Volver a comprobar", tone: "warning" };
  if (reason === "RECONNECT") return { title: "Calendario sin conexión", message: "El estudio debe reconectar su calendario. La selección se conserva y puedes comprobarla de nuevo más tarde.", action: "Comprobar de nuevo", tone: "warning" };
  if (reason === "REVIEW_REQUIRED") return { title: "Revisión necesaria", message: "El estudio debe revisar el resultado antes de continuar. Comprobar de nuevo solo intenta reconciliar la misma selección.", action: "Comprobar de nuevo", tone: "warning" };
  if (reason === "RETRY") return { title: "Calendario temporalmente inaccesible", message: "No pudimos contactar con el calendario. La selección se conserva y el reintento es seguro.", action: "Reintentar confirmación", tone: "danger" };
  return { title: "Confirmación pendiente", message: "Puedes volver a comprobar la confirmación con seguridad. Inkendar reutilizará la misma selección.", action: "Comprobar confirmación", tone: "warning" };
}

function formValue(formData: FormData | undefined, name: string): string | null { const entry = formData?.get(name); return typeof entry === "string" ? entry : null; }

export function ErrorBoundary() {
  const error = useRouteError();
  const temporary = isRouteErrorResponse(error) && error.status === 503;
  return <PublicLinkShell><PublicHeading title={temporary ? "No podemos consultar la oferta ahora" : "Esta oferta no está disponible"} label={temporary ? "Temporal" : "No disponible"} tone={temporary ? "warning" : "neutral"} /><p>{temporary ? "El servicio de calendario no responde. Inténtalo de nuevo dentro de unos minutos." : "El enlace puede haber caducado o haber sido reemplazado. Pide al estudio un enlace vigente."}</p></PublicLinkShell>;
}
