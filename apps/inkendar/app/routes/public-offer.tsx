import { Form, useActionData, useLoaderData } from "react-router";
import type { PublicBookingOfferView } from "@inkendar/application";
import type { Route } from "./+types/public-offer";
import { publicBookingOfferHandlers, publicBookingOfferHeaders } from "../public-booking-offer.server.js";
import { PublicLinkShell } from "../ui/shells.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Opciones de fecha | Inkendar" }, { name: "robots", content: "noindex,nofollow" }, { name: "referrer", content: "no-referrer" }]; }
export function headers() { return Object.fromEntries(publicBookingOfferHeaders()); }
export async function loader({ request, params }: Route.LoaderArgs) {
  const response = await publicBookingOfferHandlers.loader(request, params.token);
  if (!response.ok) throw new Response("Esta oferta no está disponible.", { status: 404, headers: publicBookingOfferHeaders() });
  return response;
}
export async function action({ request, params }: Route.ActionArgs) {
  const response = await publicBookingOfferHandlers.action(request, params.token);
  if (response.status === 404) throw new Response("Esta oferta no está disponible.", { status: 404, headers: publicBookingOfferHeaders() });
  return response;
}

export default function PublicOffer() {
  const data = useLoaderData() as PublicBookingOfferView;
  const actionData = useActionData() as { state?: "CONFIRMED" | "SELECTION_PENDING_CONFIRMATION"; reason?: "CONFLICT" | "REVIEW_REQUIRED" | "RECONNECT" | "RETRY" } | undefined;
  const pendingMessage = actionData?.state === "SELECTION_PENDING_CONFIRMATION" ? confirmationMessage(actionData.reason) : null;
  return <PublicLinkShell>
      {data.state === "OPEN" ? <>
        <h1>Opciones reservadas provisionalmente</h1>
        <p>Estas opciones para {data.artistDisplayName} están bloqueadas temporalmente hasta <time dateTime={data.expiresAt}>{data.expiresAt}</time>. Todavía requieren confirmación.</p>
        <p>Zona horaria: {data.timeZone ?? "UTC"}</p>
        <ol>{data.options.map((option) => <li key={option.selector}>
          <p><time dateTime={option.startUtc}>{option.startUtc}</time> – <time dateTime={option.endUtc}>{option.endUtc}</time></p>
          <Form method="post">
            <input type="hidden" name="selector" value={option.selector}/>
            <button type="submit">Elegir esta opción</button>
          </Form>
        </li>)}</ol>
      </> : data.state === "CONFIRMED" ? <>
        <h1>Cita confirmada</h1>
        <p>La cita con {data.artistDisplayName} quedó confirmada el <time dateTime={data.confirmedAt}>{data.confirmedAt}</time>.</p>
        <p>Zona horaria: {data.timeZone ?? "UTC"}</p>
        <p><time dateTime={data.options[0]?.startUtc}>{data.options[0]?.startUtc}</time> – <time dateTime={data.options[0]?.endUtc}>{data.options[0]?.endUtc}</time></p>
      </> : <>
        <h1>Selección recibida</h1>
        <p>Pendiente de confirmación para {data.artistDisplayName}. La confirmación sigue pendiente. Puedes reintentarla con seguridad.</p>
        <p>Zona horaria: {data.timeZone ?? "UTC"}</p>
        <p><time dateTime={data.options[0]?.startUtc}>{data.options[0]?.startUtc}</time> – <time dateTime={data.options[0]?.endUtc}>{data.options[0]?.endUtc}</time></p>
        {pendingMessage ? <p className="form-error" role="alert">{pendingMessage}</p> : null}
        <Form method="post"><input type="hidden" name="intent" value="confirm"/><button type="submit">Reintentar confirmación</button></Form>
      </>}
  </PublicLinkShell>;
}

function confirmationMessage(reason: "CONFLICT" | "REVIEW_REQUIRED" | "RECONNECT" | "RETRY" | undefined): string {
  if (reason === "CONFLICT") return "El horario ya no está libre. La selección sigue pendiente y el estudio debe revisarla.";
  if (reason === "RECONNECT") return "El calendario debe reconectarse. La selección sigue pendiente.";
  if (reason === "REVIEW_REQUIRED") return "No pudimos reconciliar el evento con seguridad. La selección sigue pendiente para revisión.";
  return "No pudimos completar la confirmación. La selección sigue pendiente; inténtalo de nuevo.";
}

export function ErrorBoundary() {
  return <PublicLinkShell><h1>Esta oferta no está disponible</h1><p>El enlace puede haber caducado o haber sido reemplazado. Pide al estudio un enlace vigente.</p></PublicLinkShell>;
}
