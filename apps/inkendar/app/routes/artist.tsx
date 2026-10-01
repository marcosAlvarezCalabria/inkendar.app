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
  const dayGroups = groupAppointmentsByLocalDay(appointments);

  return (
    <section className="shell-panel" aria-labelledby="artist-agenda-title">
      <h2 id="artist-agenda-title">Próximas citas</h2>
      {appointments.length === 0 ? (
        <EmptyState title="No tienes próximas citas confirmadas.">Cuando el estudio confirme una cita contigo aparecerá aquí.</EmptyState>
      ) : (
        <div className="appointment-days">
          {dayGroups.map((group, groupIndex) => {
            const headingId = `artist-agenda-day-${groupIndex}`;
            return (
              <section className="appointment-day" aria-labelledby={headingId} key={`${group.dateTime}-${groupIndex}`}>
                <h3 className="appointment-day-heading" id={headingId}>
                  <time dateTime={group.dateTime}>{group.label}</time>
                </h3>
                <ol className="appointment-list">
                  {group.appointments.map(({ appointment, position }) => {
                    const endsOnAnotherDay = localDay(appointment.endUtc, appointment.timeZone).dateTime !== group.dateTime;
                    return (
                      <li
                        className="appointment-card"
                        data-next={position === 0 ? "true" : undefined}
                        key={`${appointment.startUtc}-${appointment.endUtc}-${position}`}
                      >
                        {position === 0 ? <p className="appointment-kicker"><strong>Próxima cita</strong></p> : null}
                        <h4>{appointment.customerDisplayName}</h4>
                        <p className="appointment-summary">{appointment.caseSummary}</p>
                        <dl className="appointment-details">
                          <div>
                            <dt>Horario</dt>
                            <dd className="appointment-time">
                              <span>
                                <time dateTime={appointment.startUtc}>{formatTime(appointment.startUtc, appointment.timeZone)}</time>
                                {" – "}
                                <time dateTime={appointment.endUtc}>
                                  {endsOnAnotherDay
                                    ? formatDateTime(appointment.endUtc, appointment.timeZone)
                                    : formatTime(appointment.endUtc, appointment.timeZone)}
                                </time>
                              </span>
                              <span className="appointment-timezone">Zona horaria: {appointment.timeZone}</span>
                            </dd>
                          </div>
                          {appointment.bodyArea ? <div><dt>Zona del cuerpo</dt><dd>{appointment.bodyArea}</dd></div> : null}
                          {appointment.size ? <div><dt>Tamaño</dt><dd>{appointment.size}</dd></div> : null}
                        </dl>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
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

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

type AppointmentDayGroup = Readonly<{
  dateTime: string;
  label: string;
  appointments: readonly Readonly<{ appointment: ArtistAgendaItem; position: number }>[];
}>;

function groupAppointmentsByLocalDay(appointments: readonly ArtistAgendaItem[]): readonly AppointmentDayGroup[] {
  const groups: Array<{
    dateTime: string;
    label: string;
    appointments: Array<{ appointment: ArtistAgendaItem; position: number }>;
  }> = [];

  appointments.forEach((appointment, position) => {
    const day = localDay(appointment.startUtc, appointment.timeZone);
    const current = groups.at(-1);
    if (!current || current.dateTime !== day.dateTime) {
      groups.push({ ...day, appointments: [{ appointment, position }] });
      return;
    }
    current.appointments.push({ appointment, position });
  });

  return groups;
}

function localDay(value: string, timeZone: string): Readonly<{ dateTime: string; label: string }> {
  const date = new Date(value);
  const keyParts = new Intl.DateTimeFormat("es-ES-u-ca-gregory-nu-latn", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => keyParts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new RangeError("No se pudo resolver el día local de la cita.");

  return {
    dateTime: `${year}-${month}-${day}`,
    label: new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      weekday: "long",
      year: "numeric",
      timeZone,
    }).format(date),
  };
}
