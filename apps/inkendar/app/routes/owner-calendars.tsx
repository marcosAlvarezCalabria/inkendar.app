import { Form, isRouteErrorResponse, Link, useActionData, useLoaderData, useRouteError, useSearchParams } from "react-router";
import type { ArtistCalendarAssignment, FreeChoiceOwnerManagement, GoogleCalendar, GoogleConnectionStatus } from "@inkendar/application";
import type { AvailabilityRules } from "@inkendar/domain";
import type { Route } from "./+types/owner-calendars";
import { ownerGoogleCalendarHandlers } from "../owner-google-calendar.server.js";
import { ownerAvailabilityHandlers } from "../owner-availability.server.js";

import { ownerFreeChoiceAvailabilityHandlers } from "../free-choice-availability.server.js";
import { ownerFreeChoiceDecisionHandlers } from "../free-choice-owner-decision.server.js";
type View = Readonly<{
  connectionStatus: GoogleConnectionStatus | "NOT_CONNECTED";
  calendars: readonly GoogleCalendar[];
  artists: readonly ArtistCalendarAssignment[];
  availabilityByArtist: Readonly<Record<string, AvailabilityRules | null>>;
  freeChoice: FreeChoiceOwnerManagement;
}>;

export function meta(): Route.MetaDescriptors { return [{ title: "Google Calendar | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerGoogleCalendarHandlers.loader(request);
  if (response.status >= 400) throw response;
  const management = await response.json() as Omit<View, "availabilityByArtist" | "freeChoice">;
  const availabilityUrl = new URL(request.url);
  availabilityUrl.searchParams.delete("artistProfileId");
  for (const artist of management.artists) availabilityUrl.searchParams.append("artistProfileId", artist.id);
  const availabilityResponse = await ownerAvailabilityHandlers.loader(new Request(availabilityUrl, { headers: request.headers }));
  if (availabilityResponse.status >= 400) throw availabilityResponse;
  const availability = await availabilityResponse.json() as Pick<View, "availabilityByArtist">;
  let freeChoice: FreeChoiceOwnerManagement = { cases: [], pendingRequests: [] };
  try {
    const freeChoiceResponse = await ownerFreeChoiceAvailabilityHandlers.loader(request);
    if (freeChoiceResponse.ok) freeChoice = await freeChoiceResponse.json() as FreeChoiceOwnerManagement;
  } catch {
    // The additive panel must not make existing calendar management unavailable.
  }
  return Response.json({ ...management, ...availability, freeChoice }, { headers: response.headers });
}
export async function action({ request }: Route.ActionArgs) { const params=new URL(request.url).searchParams; return params.get("freeChoiceDecision") === "1" ? ownerFreeChoiceDecisionHandlers.action(request) : params.get("freeChoice") === "1" ? ownerFreeChoiceAvailabilityHandlers.action(request) : params.get("availability") === "1" ? ownerAvailabilityHandlers.action(request) : ownerGoogleCalendarHandlers.action(request); }

export default function OwnerCalendars() {
  const data = useLoaderData() as View;
  const actionData = useActionData() as { error?: string; saved?: boolean; slots?: readonly { startUtc:string; endUtc:string; startLocal:string; endLocal:string }[]; accessUrl?:string; expiresAt?:string } | undefined;
  const [params] = useSearchParams();
  return <main className="shell-page">
    <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Google Calendar</h1></div><Link to="/app/owner">Volver al panel</Link></header>
    {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
    <CalendarManagement data={data} result={params.get("result")} />
    <AvailabilityManagement artists={data.artists} availabilityByArtist={data.availabilityByArtist} freeChoice={data.freeChoice} actionData={actionData} />
    <FreeChoiceDecisionList requests={data.freeChoice.pendingRequests} />
  </main>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const unavailable = isRouteErrorResponse(error) && error.status === 503;
  return <main className="status-page">
    <p className="eyebrow">Inkendar</p>
    <h1>Google Calendar no disponible</h1>
    <p>{unavailable ? "Inténtalo de nuevo más tarde." : "No se pudo cargar la configuración de calendarios."}</p>
    <Link to="/app/owner">Volver al panel</Link>
  </main>;
}

export function CalendarManagement({ data, result }: Readonly<{ data: Omit<View, "availabilityByArtist" | "freeChoice">; result: string | null }> ) {
  const writable = data.calendars.filter((calendar) => calendar.accessRole === "writer" || calendar.accessRole === "owner");
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
      {data.connectionStatus === "ACTIVE" ? data.artists.map((artist) => <Form method="post" className="shell-panel record-form" key={artist.id}>
        <input type="hidden" name="intent" value="assign" />
        <input type="hidden" name="artistProfileId" value={artist.id} />
        <label>{artist.displayName}<select name="calendarId" defaultValue={artist.calendarId ?? ""}>
          <option value="">Desasignar</option>
          {data.calendars.filter((calendar) => calendar.id === artist.calendarId && calendar.accessRole !== "writer" && calendar.accessRole !== "owner").map((calendar) => <option key={calendar.id} value={calendar.id} disabled>{calendar.summary} · incompatible con citas privadas</option>)}
          {writable.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " · principal" : ""}{calendar.timeZone ? ` · ${calendar.timeZone}` : ""}</option>)}
        </select></label>
        <button type="submit">Guardar asignación</button>
      </Form>) : null}
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

function FreeChoiceDecisionList({requests}:{requests:FreeChoiceOwnerManagement["pendingRequests"]}) {
  if(requests.length===0)return null;
  return <section className="records" aria-labelledby="free-choice-decisions"><h2 id="free-choice-decisions">Decidir solicitudes de elección libre</h2>{requests.map(item=><article className="shell-panel" key={item.id}><h3>{item.customerName} · {item.caseSummary}</h3><p>{item.artistDisplayName} · {item.startUtc}–{item.endUtc}</p>{item.status==="PENDING_OWNER_APPROVAL"?<Form method="post" action="?freeChoiceDecision=1"><input type="hidden" name="requestId" value={item.id}/><button name="intent" value="approve" type="submit">Aprobar y confirmar</button><button className="secondary" name="intent" value="reject" type="submit">Rechazar</button></Form>:<Form method="post" action="?freeChoiceDecision=1"><p>Confirmación en curso. El reintento recupera el mismo evento.</p><input type="hidden" name="requestId" value={item.id}/><button name="intent" value="approve" type="submit">Reintentar confirmación</button></Form>}</article>)}</section>;
}
export function AvailabilityManagement({artists,availabilityByArtist,freeChoice={cases:[],pendingRequests:[]},actionData}:Readonly<{artists:readonly ArtistCalendarAssignment[];availabilityByArtist:Readonly<Record<string, AvailabilityRules | null>>;freeChoice?:FreeChoiceOwnerManagement;actionData:{saved?:boolean;slots?:readonly {startUtc:string;endUtc:string;startLocal:string;endLocal:string}[];accessUrl?:string;expiresAt?:string} | undefined}>) { return <section className="records" aria-labelledby="availability-title"><h2 id="availability-title">Disponibilidad semanal</h2><p>Configura ventanas como día (0 domingo–6 sábado), inicio y fin. La previsualización muestra candidatos; no confirma citas.</p>{actionData?.saved?<p role="status">Reglas guardadas.</p>:null}{actionData?.accessUrl?<p role="status">Enlace emitido hasta {actionData.expiresAt}: <a href={actionData.accessUrl}>{actionData.accessUrl}</a></p>:null}{artists.map(artist=>{const saved=availabilityByArtist[artist.id],assignedCases=freeChoice.cases.filter(item=>item.artistProfileId===artist.id);return <div className="shell-panel" key={`availability-${artist.id}`}><h3>{artist.displayName}</h3><form method="post" action="?availability=1" className="record-form"><input type="hidden" name="intent" value="save-availability"/><input type="hidden" name="artistProfileId" value={artist.id}/><label>Zona IANA<input name="timeZone" defaultValue={saved?.timeZone ?? "Europe/Madrid"} required/></label><label>Ventanas<textarea name="windows" defaultValue={saved ? saved.windows.map(window=>`${window.weekday},${window.start},${window.end}`).join("\n") : "1,09:00,14:00\n1,15:00,18:00"}/></label><label>Incremento (min)<input name="slotIncrementMinutes" type="number" min="5" max="240" defaultValue={saved?.slotIncrementMinutes ?? 30}/></label><label>Buffer antes<input name="bufferBeforeMinutes" type="number" min="0" max="240" defaultValue={saved?.bufferBeforeMinutes ?? 15}/></label><label>Buffer después<input name="bufferAfterMinutes" type="number" min="0" max="240" defaultValue={saved?.bufferAfterMinutes ?? 15}/></label><button type="submit">Guardar disponibilidad</button></form><form method="post" action="?availability=1" className="record-form"><input type="hidden" name="intent" value="preview-availability"/><input type="hidden" name="artistProfileId" value={artist.id}/><label>Desde (UTC)<input name="rangeStart" type="datetime-local" required/></label><label>Hasta (UTC)<input name="rangeEnd" type="datetime-local" required/></label><label>Duración (min)<input name="durationMinutes" type="number" min="15" max="480" defaultValue="60"/></label><button type="submit">Previsualizar huecos</button></form><form method="post" action="?freeChoice=1" className="record-form"><input type="hidden" name="artistProfileId" value={artist.id}/><label>Caso abierto asignado<select name="tattooCaseId" required><option value="">Selecciona un caso</option>{assignedCases.map(item=><option key={item.id} value={item.id}>{item.summary}</option>)}</select></label><label>Rango desde (UTC)<input name="rangeStart" type="datetime-local" required/></label><label>Rango hasta (UTC)<input name="rangeEnd" type="datetime-local" required/></label><label>Duración (min)<input name="durationMinutes" type="number" min="15" max="480" defaultValue="60"/></label><label>Enlace válido hasta (UTC)<input name="expiresAt" type="datetime-local" required/></label><button type="submit" disabled={assignedCases.length===0}>Emitir o rotar enlace del caso</button></form></div>})}{actionData?.slots?<ul>{actionData.slots.map(slot=><li key={slot.startUtc}>{slot.startLocal} – {slot.endLocal} ({slot.startUtc})</li>)}</ul>:null}<h2>Solicitudes pendientes</h2>{freeChoice.pendingRequests.length===0?<p>No hay solicitudes pendientes.</p>:<ul>{freeChoice.pendingRequests.map((item,index)=><li key={`${item.startUtc}-${index}`}>{item.customerName} · {item.caseSummary} · {item.artistDisplayName} · {item.startUtc}–{item.endUtc} · vence {item.expiresAt}</li>)}</ul>}</section>; }
