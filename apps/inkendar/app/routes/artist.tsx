import { isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/artist";

import type { ArtistAgendaItem } from "@inkendar/application";
import { artistAgendaHandlers } from "../artist-agenda.server.js";
import { EmptyState, StatusPage } from "../ui/feedback.js";
import { ArtistShell as ArtistFrame } from "../ui/shells.js";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Área del artista | Inkendar" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const response = await artistAgendaHandlers.loader(request);
  if (response.status >= 500) throw response;
  return response;
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function ArtistShell() {
  const { displayName, appointments } = useLoaderData<typeof loader>();
  return <ArtistShellView displayName={displayName} appointments={appointments} />;
}

export function ArtistShellView({ displayName, appointments }: Readonly<{
  displayName: string;
  appointments: readonly ArtistAgendaItem[];
}>) {
  return (
    <ArtistFrame displayName={displayName}>
      <ArtistAgenda appointments={appointments} />
    </ArtistFrame>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return isRouteErrorResponse(error) && error.status === 403 ? <Denied /> : <AgendaUnavailable />;
}

export function ArtistAgenda({ appointments }: Readonly<{ appointments: readonly ArtistAgendaItem[] }>) {
  return (
    <section className="shell-panel" aria-labelledby="artist-agenda-title">
      <h2 id="artist-agenda-title">Próximas citas</h2>
      {appointments.length === 0 ? (
        <EmptyState title="No tienes próximas citas confirmadas.">Cuando el estudio confirme una cita contigo aparecerá aquí.</EmptyState>
      ) : (
        <ol className="appointment-list">
          {appointments.map((appointment) => (
            <li className="appointment-card" key={`${appointment.startUtc}-${appointment.endUtc}-${appointment.caseSummary}`}>
              <h3>{appointment.customerDisplayName}</h3>
              <p>{appointment.caseSummary}</p>
              <dl className="appointment-details">
                <div>
                  <dt>Horario</dt>
                  <dd>
                    <time dateTime={appointment.startUtc}>{formatDateTime(appointment.startUtc, appointment.timeZone)}</time>
                    {" – "}
                    <time dateTime={appointment.endUtc}>{formatDateTime(appointment.endUtc, appointment.timeZone)}</time>
                    {` (${appointment.timeZone})`}
                  </dd>
                </div>
                {appointment.bodyArea ? <div><dt>Zona del cuerpo</dt><dd>{appointment.bodyArea}</dd></div> : null}
                {appointment.size ? <div><dt>Tamaño</dt><dd>{appointment.size}</dd></div> : null}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Denied() {
  return <StatusPage tone="danger" title="Acceso denegado">Tu cuenta no tiene acceso a esta área.</StatusPage>;
}

function AgendaUnavailable() {
  return <StatusPage tone="warning" title="Agenda no disponible">No se pudo cargar la agenda.</StatusPage>;
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
