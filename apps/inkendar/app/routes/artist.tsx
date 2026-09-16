import { Form, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/artist";

import type { ArtistAgendaItem } from "@inkendar/application";
import { artistAgendaHandlers } from "../artist-agenda.server.js";

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
    <main className="shell-page">
      <header className="shell-header">
        <div><p className="eyebrow">Inkendar · Artista</p><h1>Hola, {displayName}</h1></div>
        <Form method="post" action="/logout"><button className="secondary" type="submit">Cerrar sesión</button></Form>
      </header>
      <ArtistAgenda appointments={appointments} />
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return isRouteErrorResponse(error) && error.status === 403 ? <Denied /> : <AgendaUnavailable />;
}

export function ArtistAgenda({ appointments }: Readonly<{ appointments: readonly ArtistAgendaItem[] }>) {
  return (
    <section className="shell-panel" aria-labelledby="artist-agenda-title">
      <div className="section-header">
        <div>
          <p className="eyebrow">Solo lectura</p>
          <h2 id="artist-agenda-title">Próximas citas</h2>
        </div>
      </div>
      {appointments.length === 0 ? (
        <p>No tienes próximas citas confirmadas.</p>
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
  return <main className="status-page"><p className="eyebrow">Inkendar</p><h1>Acceso denegado</h1><p>Tu cuenta no tiene acceso a esta área.</p></main>;
}

function AgendaUnavailable() {
  return <main className="status-page"><p className="eyebrow">Inkendar</p><h1>Agenda no disponible</h1><p>No se pudo cargar la agenda.</p></main>;
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
