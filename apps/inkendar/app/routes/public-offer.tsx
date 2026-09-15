import { useLoaderData } from "react-router";
import type { PublicBookingOfferView } from "@inkendar/application";
import type { Route } from "./+types/public-offer";
import { publicBookingOfferHandlers, publicBookingOfferHeaders } from "../public-booking-offer.server.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Opciones de fecha | Inkendar" }, { name: "robots", content: "noindex,nofollow" }, { name: "referrer", content: "no-referrer" }]; }
export function headers() { return Object.fromEntries(publicBookingOfferHeaders()); }
export async function loader({ request, params }: Route.LoaderArgs) {
  const response = await publicBookingOfferHandlers.loader(request, params.token);
  if (!response.ok) throw new Response("Esta oferta no está disponible.", { status: 404, headers: publicBookingOfferHeaders() });
  return response;
}

export default function PublicOffer() {
  const data = useLoaderData() as PublicBookingOfferView;
  return <main className="public-offer-page">
    <section className="shell-panel public-offer-card">
      <p className="eyebrow">Inkendar</p>
      <h1>Opciones reservadas provisionalmente</h1>
      <p>Estas opciones para {data.artistDisplayName} están bloqueadas temporalmente hasta <time dateTime={data.expiresAt}>{data.expiresAt}</time>. Todavía no son una cita confirmada.</p>
      <p>Zona horaria: {data.timeZone ?? "UTC"}</p>
      <ol>{data.options.map((option) => <li key={`${option.startUtc}-${option.endUtc}`}><time dateTime={option.startUtc}>{option.startUtc}</time> – <time dateTime={option.endUtc}>{option.endUtc}</time></li>)}</ol>
    </section>
  </main>;
}

export function ErrorBoundary() {
  return <main className="public-offer-page"><section className="shell-panel public-offer-card"><p className="eyebrow">Inkendar</p><h1>Esta oferta no está disponible</h1><p>El enlace puede haber caducado o haber sido reemplazado. Pide al estudio un enlace vigente.</p></section></main>;
}
