import { Form, Link, useActionData, useLoaderData, useRouteError } from "react-router";
import { StatusPage } from "../ui/feedback.js";
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

export default function OwnerOffers() {
  const data = useLoaderData() as BookingOfferManagement;
  const actionData = useActionData() as { error?: string; accessUrl?: string; expiresAt?: string } | undefined;
  return <OwnerShell title="Ofertas de fechas">
    {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
    {actionData?.accessUrl ? <section className="shell-panel" aria-live="polite"><h2>Enlace emitido</h2><p>Este enlace solo se muestra ahora. Compártelo por un canal seguro; al rotarlo, el anterior dejará de funcionar.</p><p><a href={actionData.accessUrl} rel="noreferrer">{actionData.accessUrl}</a></p><p>Vence: {actionData.expiresAt}</p></section> : null}
    <section className="shell-panel"><h2>Caducidad del estudio</h2><Form method="post" className="record-form"><input type="hidden" name="intent" value="configure-expiry"/><label>Horas<input name="expiryHours" type="number" min="1" max="32767" defaultValue={data.expiryHours} required/></label><button type="submit">Guardar plazo</button></Form></section>
    <section className="shell-panel"><h2>Nueva oferta preaprobada</h2>{data.cases.length && data.artists.length ? <Form method="post" className="record-form"><input type="hidden" name="intent" value="create"/><label>Caso<select name="tattooCaseId" required><option value="">Selecciona un caso</option>{data.cases.map(item=><option key={item.id} value={item.id}>{item.summary}</option>)}</select></label><label>Artista<select name="artistProfileId" required><option value="">Selecciona un artista</option>{data.artists.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><label>Opciones UTC (inicio,fin; una por línea)<textarea name="options" placeholder="2026-09-20T09:00,2026-09-20T10:00" required/></label><button type="submit">Crear oferta y bloquear</button></Form> : <p>Necesitas al menos un caso abierto y un artista.</p>}</section>
    <section className="records"><div className="section-header"><h2>Ofertas</h2><Form method="post"><input type="hidden" name="intent" value="expire-due"/><button className="secondary" type="submit">Liberar vencidas</button></Form></div>{data.offers.length ? data.offers.map(offer=><article className="shell-panel" key={offer.id}><h3>{data.cases.find(item=>item.id===offer.tattooCaseId)?.summary ?? "Caso no disponible"}</h3><p>{offerStatusLabel(offer.status)} · vence {offer.expiresAt}</p><ul>{offer.options.map(option=><li key={option.id}>{option.startUtc} – {option.endUtc} · {optionStatusLabel(option.status)}</li>)}</ul>{offer.status === "OPEN" ? <Form method="post"><input type="hidden" name="intent" value="rotate-access"/><input type="hidden" name="offerId" value={offer.id}/><button className="secondary" type="submit">Emitir o rotar enlace de lectura</button></Form> : null}</article>) : <p>Todavía no hay ofertas.</p>}</section>
  </OwnerShell>;
}

export function ErrorBoundary() {
  useRouteError();
  return <StatusPage tone="warning" title="Ofertas no disponibles" action={<Link className="button" to="/app/owner/offers">Reintentar</Link>}>
    No se pudieron cargar las ofertas. Inténtalo de nuevo más tarde.
  </StatusPage>;
}

function offerStatusLabel(status: BookingOfferStatus): string {
  if (status === "OPEN") return "Abierta";
  if (status === "SELECTED_PENDING_CONFIRMATION") return "Selección recibida · pendiente de confirmación";
  return status === "CONFIRMED" ? "Confirmada" : "Caducada";
}

function optionStatusLabel(status: BookingOptionStatus): string {
  return status === "HELD" ? "bloqueada" : status === "SELECTED" ? "seleccionada" : status === "CONFIRMED" ? "confirmada" : "liberada";
}
