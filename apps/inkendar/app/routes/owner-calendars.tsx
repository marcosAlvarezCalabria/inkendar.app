import { Link, useActionData, useLoaderData, useSearchParams } from "react-router";
import type { ArtistCalendarAssignment, GoogleCalendar, GoogleConnectionStatus } from "@inkendar/application";
import type { Route } from "./+types/owner-calendars";
import { ownerGoogleCalendarHandlers } from "../owner-google-calendar.server.js";

type View = Readonly<{
  connectionStatus: GoogleConnectionStatus | "NOT_CONNECTED";
  calendars: readonly GoogleCalendar[];
  artists: readonly ArtistCalendarAssignment[];
}>;

export function meta(): Route.MetaDescriptors { return [{ title: "Google Calendar | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerGoogleCalendarHandlers.loader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerGoogleCalendarHandlers.action(request); }

export default function OwnerCalendars() {
  const data = useLoaderData() as View;
  const actionData = useActionData() as { error?: string } | undefined;
  const [params] = useSearchParams();
  return <main className="shell-page">
    <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Google Calendar</h1></div><Link to="/app/owner">Volver al panel</Link></header>
    {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
    <CalendarManagement data={data} result={params.get("result")} />
  </main>;
}

export function CalendarManagement({ data, result }: Readonly<{ data: View; result: string | null }>) {
  const writable = data.calendars.filter((calendar) => calendar.accessRole === "writer" || calendar.accessRole === "writerWithoutPrivateAccess" || calendar.accessRole === "owner");
  return <>
    {message(result) ? <p className="shell-panel" role="status">{message(result)}</p> : null}
    <section className="shell-panel">
      <h2>Conexión del estudio</h2>
      <p>{connectionLabel(data.connectionStatus)}</p>
      {data.connectionStatus === "ACTIVE" ? <div className="calendar-actions">
        <form method="post"><input type="hidden" name="intent" value="connect" /><button type="submit">Reconectar</button></form>
        <form method="post"><input type="hidden" name="intent" value="disconnect" /><button className="secondary" type="submit">Desconectar</button></form>
      </div> : <form method="post"><input type="hidden" name="intent" value="connect" /><button type="submit">Conectar Google Calendar</button></form>}
    </section>
    <section className="records" aria-labelledby="artist-calendar-title">
      <h2 id="artist-calendar-title">Calendario por artista</h2>
      {data.connectionStatus !== "ACTIVE" ? <p>Conecta o reconecta Google Calendar para gestionar asignaciones.</p> : null}
      {data.connectionStatus === "ACTIVE" && data.artists.length === 0 ? <p>Todavía no hay artistas.</p> : null}
      {data.connectionStatus === "ACTIVE" ? data.artists.map((artist) => <form method="post" className="shell-panel record-form" key={artist.id}>
        <input type="hidden" name="intent" value="assign" />
        <input type="hidden" name="artistProfileId" value={artist.id} />
        <label>{artist.displayName}<select name="calendarId" defaultValue={artist.calendarId ?? ""}>
          <option value="">Desasignar</option>
          {writable.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " · principal" : ""}{calendar.timeZone ? ` · ${calendar.timeZone}` : ""}</option>)}
        </select></label>
        <button type="submit">Guardar asignación</button>
      </form>) : null}
    </section>
  </>;
}

function connectionLabel(status: View["connectionStatus"]): string {
  if (status === "ACTIVE") return "Conexión configurada";
  if (status === "REAUTH_REQUIRED") return "La conexión necesita autorización de nuevo";
  return "Google Calendar no está conectado";
}
function message(result: string | null): string | null {
  const messages: Record<string, string> = {
    connected: "Conexión guardada; pendiente de verificación operativa.",
    denied: "La autorización fue cancelada.",
    "invalid-state": "La autorización ya no es válida. Iníciala de nuevo.",
    "reconnect-required": "Google no entregó el permiso necesario. Reconecta la cuenta.",
    failed: "No se pudo completar la conexión.",
    disconnected: "Google Calendar se ha desconectado.",
    "assignment-saved": "Asignación guardada.",
  };
  return result ? messages[result] ?? null : null;
}
