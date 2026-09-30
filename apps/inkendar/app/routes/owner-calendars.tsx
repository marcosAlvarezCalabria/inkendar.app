import { Form, isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useRouteError, useSearchParams } from "react-router";
import { EmptyState, Notice, StatusBadge, StatusPage } from "../ui/feedback.js";
import { OwnerShell } from "../ui/shells.js";
import type { ArtistCalendarAssignment, FreeChoiceOwnerManagement, GoogleCalendar, GoogleConnectionStatus } from "@inkendar/application";
import type { AvailabilityRules } from "@inkendar/domain";
import type { Route } from "./+types/owner-calendars";
import { ownerGoogleCalendarHandlers } from "../owner-google-calendar.server.js";
import { ownerAvailabilityHandlers } from "../owner-availability.server.js";

import { ownerFreeChoiceAvailabilityHandlers } from "../free-choice-availability.server.js";
import { ownerFreeChoiceDecisionHandlers } from "../free-choice-owner-decision.server.js";
export type CalendarView = Readonly<{
  connectionStatus: GoogleConnectionStatus | "NOT_CONNECTED";
  calendars: readonly GoogleCalendar[];
  artists: readonly ArtistCalendarAssignment[];
  availabilityByArtist: Readonly<Record<string, AvailabilityRules | null>>;
  freeChoice: FreeChoiceOwnerManagement;
}>;
type AvailabilitySlotView = Readonly<{ startUtc:string; endUtc:string; startLocal:string; endLocal:string }>;
export type CalendarActionData = Readonly<{ error?:string; saved?:boolean; slots?:readonly AvailabilitySlotView[]; accessUrl?:string; expiresAt?:string }>;
export type CalendarPending = Readonly<{ kind:"connection"|"assignment"|"availability"|"preview"|"issue"|"decision"; targetId?:string|undefined; intent?:string|undefined }>;

export function meta(): Route.MetaDescriptors { return [{ title: "Google Calendar | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerGoogleCalendarHandlers.loader(request);
  if (response.status >= 400) throw response;
  const management = await response.json() as Omit<CalendarView, "availabilityByArtist" | "freeChoice">;
  const availabilityUrl = new URL(request.url);
  availabilityUrl.searchParams.delete("artistProfileId");
  for (const artist of management.artists) availabilityUrl.searchParams.append("artistProfileId", artist.id);
  const availabilityResponse = await ownerAvailabilityHandlers.loader(new Request(availabilityUrl, { headers: request.headers }));
  if (availabilityResponse.status >= 400) throw availabilityResponse;
  const availability = await availabilityResponse.json() as Pick<CalendarView, "availabilityByArtist">;
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
  const data = useLoaderData() as CalendarView;
  const actionData = useActionData() as CalendarActionData | undefined;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const pending = navigation.state === "submitting" ? calendarPendingMutation(navigation.formData, navigation.formAction) : null;
  return <OwnerShell title="Google Calendar">
    {actionData?.error ? <Notice tone="danger" title="No se pudo completar la acción">{actionData.error}</Notice> : null}
    <CalendarWorkspace data={data} result={params.get("result")} actionData={actionData} pending={pending} />
  </OwnerShell>;
}

export function CalendarWorkspace({data,result,actionData,pending}:Readonly<{data:CalendarView;result:string|null;actionData:CalendarActionData|undefined;pending:CalendarPending|null}>) {
  return <>
    <CalendarManagement data={data} result={result} pending={pending} />
    <FreeChoiceDecisionList requests={data.freeChoice.pendingRequests} pending={pending} />
    <AvailabilityManagement artists={data.artists} availabilityByArtist={data.availabilityByArtist} freeChoice={data.freeChoice} actionData={actionData} pending={pending} />
  </>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const unavailable = isRouteErrorResponse(error) && error.status === 503;
  return <StatusPage tone="warning" title="Google Calendar no disponible" action={<Link to="/app/owner">Volver al panel</Link>}>
    {unavailable ? "Inténtalo de nuevo más tarde." : "No se pudo cargar la configuración de calendarios."}
  </StatusPage>;
}

export function CalendarManagement({data,result,pending=null}:Readonly<{data:Omit<CalendarView,"availabilityByArtist"|"freeChoice">;result:string|null;pending?:CalendarPending|null}>) {
  const writable=data.calendars.filter(isWritableCalendar);
  const connection=connectionPresentation(data.connectionStatus);
  const connectionPending=pending?.kind==="connection";
  const feedback=message(result);
  return <>
    {feedback?<Notice tone={messageTone(result)} title={feedback}/>:null}
    <section className="shell-panel calendar-connection" aria-labelledby="calendar-connection-title">
      <div className="section-header"><h2 id="calendar-connection-title">Conexión del estudio</h2><StatusBadge tone={connection.tone}>{connection.badge}</StatusBadge></div>
      <p>{connection.description}</p>
      {data.connectionStatus==="ACTIVE"?<div className="calendar-actions">
        <Form method="post"><input type="hidden" name="intent" value="connect"/><button type="submit" disabled={connectionPending}>{connectionPending&&pending?.intent==="connect"?"Iniciando reconexión…":"Reconectar"}</button></Form>
        <Form method="post"><input type="hidden" name="intent" value="disconnect"/><button className="secondary" type="submit" disabled={connectionPending}>{connectionPending&&pending?.intent==="disconnect"?"Desconectando…":"Desconectar"}</button></Form>
      </div>:<Form method="post"><input type="hidden" name="intent" value="connect"/><button type="submit" disabled={connectionPending}>{connectionPending?"Abriendo autorización…":data.connectionStatus==="REAUTH_REQUIRED"?"Volver a autorizar":"Conectar Google Calendar"}</button></Form>}
    </section>
    <section className="records" aria-labelledby="artist-calendar-title">
      <h2 id="artist-calendar-title">Calendario por artista</h2>
      {data.connectionStatus!=="ACTIVE"?<EmptyState title="Asignaciones no disponibles">Las asignaciones aparecerán cuando Google Calendar esté conectado y autorizado.</EmptyState>:data.artists.length===0?<EmptyState title="Sin artistas que configurar">Todavía no hay artistas en el estudio. Este estado no significa que Google Calendar esté desconectado.</EmptyState>:data.artists.map(artist=>{
        const current=data.calendars.find(calendar=>calendar.id===artist.calendarId);
        const assignmentPending=pending?.kind==="assignment"&&pending.targetId===artist.id;
        return <Form method="post" className="shell-panel record-form calendar-assignment" key={artist.id}>
          <input type="hidden" name="intent" value="assign"/><input type="hidden" name="artistProfileId" value={artist.id}/>
          <div className="record-head"><h3>{artist.displayName}</h3><StatusBadge tone={artist.calendarId?(current&&!isWritableCalendar(current)?"warning":"success"):"neutral"}>{artist.calendarId?(current&&!isWritableCalendar(current)?"Asignación incompatible":"Calendario asignado"):"Sin calendario"}</StatusBadge></div>
          <p className="record-context">{assignmentDescription(artist,current)}</p>
          <label>Calendario operativo<select name="calendarId" defaultValue={artist.calendarId??""}>
            <option value="">Desasignar</option>
            {data.calendars.filter(calendar=>calendar.id===artist.calendarId&&!isWritableCalendar(calendar)).map(calendar=><option key={calendar.id} value={calendar.id} disabled>{calendar.summary} · incompatible con citas privadas</option>)}
            {writable.map(calendar=><option key={calendar.id} value={calendar.id}>{calendarOption(calendar)}</option>)}
          </select></label>
          <button type="submit" disabled={assignmentPending}>{assignmentPending?"Guardando asignación…":"Guardar asignación"}</button>
        </Form>;
      })}
    </section>
  </>;
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

function messageTone(result:string|null):"success"|"warning"|"danger" {
  if(result==="denied"||result==="invalid-state"||result==="reconnect-required")return "warning";
  if(result==="failed")return "danger";
  return "success";
}

export function FreeChoiceDecisionList({requests,pending=null}:Readonly<{requests:FreeChoiceOwnerManagement["pendingRequests"];pending?:CalendarPending|null}>) {
  const uniqueRequests=Array.from(new Map(requests.map(request=>[request.id,request])).values());
  return <section className="records" aria-labelledby="free-choice-decisions">
    <div className="section-header"><h2 id="free-choice-decisions">Decidir solicitudes de elección libre</h2>{uniqueRequests.length>0?<StatusBadge tone="warning">{uniqueRequests.length} por revisar</StatusBadge>:null}</div>
    {uniqueRequests.length===0?<EmptyState title="No hay solicitudes pendientes">Cuando un cliente elija libremente un hueco, aparecerá aquí antes de la configuración de disponibilidad.</EmptyState>:uniqueRequests.map(item=>{
      const requestPending=pending?.kind==="decision"&&pending.targetId===item.id;
      return <article className="shell-panel free-choice-request" key={item.id}>
        <div className="record-head"><h3>{item.customerName} · {item.caseSummary}</h3><StatusBadge tone={item.status==="PENDING_OWNER_APPROVAL"?"warning":"pending"}>{item.status==="PENDING_OWNER_APPROVAL"?"Pendiente de decisión":"En aprobación"}</StatusBadge></div>
        <p><strong>{item.artistDisplayName}</strong></p>
        <p className="calendar-time-range"><time dateTime={item.startUtc}>{humanUtc(item.startUtc)}</time><span aria-hidden="true"> — </span><time dateTime={item.endUtc}>{humanUtc(item.endUtc)}</time></p>
        <p className="meta-line">La hora se muestra en UTC porque esta proyección no expone otra zona. La solicitud vence el <time dateTime={item.expiresAt}>{humanUtc(item.expiresAt)}</time>.</p>
        {item.status==="PENDING_OWNER_APPROVAL"?<Form method="post" action="?freeChoiceDecision=1" className="record-actions">
          <input type="hidden" name="requestId" value={item.id}/>
          <button name="intent" value="approve" type="submit" disabled={requestPending}>{requestPending&&pending.intent==="approve"?"Aprobando y reconciliando…":"Aprobar y confirmar"}</button>
          <button className="secondary" name="intent" value="reject" type="submit" disabled={requestPending}>{requestPending&&pending.intent==="reject"?"Rechazando solicitud…":"Rechazar"}</button>
        </Form>:<Form method="post" action="?freeChoiceDecision=1" className="record-form">
          <p>Confirmación en curso. El reintento recupera el mismo evento. La reconciliación no afirma que la cita esté confirmada hasta recibir el estado final.</p>
          <input type="hidden" name="requestId" value={item.id}/>
          <button name="intent" value="approve" type="submit" disabled={requestPending}>{requestPending?"Reconciliando el mismo evento…":"Reintentar confirmación del mismo evento"}</button>
        </Form>}
      </article>;
    })}
  </section>;
}
export function AvailabilityManagement({artists,availabilityByArtist,freeChoice={cases:[],pendingRequests:[]},actionData,pending=null}:Readonly<{artists:readonly ArtistCalendarAssignment[];availabilityByArtist:Readonly<Record<string,AvailabilityRules|null>>;freeChoice?:FreeChoiceOwnerManagement;actionData:CalendarActionData|undefined;pending?:CalendarPending|null}>) {
  return <section className="records calendar-availability" aria-labelledby="availability-title">
    <div className="section-header"><h2 id="availability-title">Disponibilidad y enlaces por artista</h2><StatusBadge tone="info">Configuración técnica</StatusBadge></div>
    <p className="section-intro">Abre un artista cada vez. Las ventanas se interpretan en su zona IANA; los rangos de consulta y caducidad se introducen en UTC. Previsualizar no confirma una cita.</p>
    {actionData?.saved?<Notice tone="success" title="Reglas guardadas"/>:null}
    {actionData?.accessUrl?<Notice tone="warning" title="Enlace sensible y efímero"><p>Compártelo solo con la persona del caso. Cópialo ahora: no se conserva aquí como historial y no confirma una cita.</p><p className="sensitive-link"><a href={actionData.accessUrl} rel="noreferrer">{actionData.accessUrl}</a></p>{actionData.expiresAt?<p>Caduca el <time dateTime={actionData.expiresAt}>{humanUtc(actionData.expiresAt)}</time>.</p>:null}</Notice>:null}
    {artists.length===0?<EmptyState title="Sin disponibilidad que configurar">Añade un artista y conecta Google Calendar antes de definir sus ventanas.</EmptyState>:artists.map((artist,index)=>{
      const saved=availabilityByArtist[artist.id];
      const assignedCases=freeChoice.cases.filter(item=>item.artistProfileId===artist.id);
      return <details className="shell-panel calendar-disclosure" key={`availability-${artist.id}`} open={index===0}>
        <summary><span>{artist.displayName}</span><StatusBadge tone={saved?"success":"neutral"}>{saved?saved.timeZone:"Sin reglas guardadas"}</StatusBadge></summary>
        <div className="calendar-disclosure-body">
          <section className="calendar-form-section" aria-labelledby={`rules-${artist.id}`}>
            <h3 id={`rules-${artist.id}`}>Reglas semanales</h3><p>Día 0 es domingo y día 6 es sábado. Cada línea usa <strong>día,inicio,fin</strong> en la zona IANA indicada.</p>
            <Form method="post" action="?availability=1" className="record-form"><input type="hidden" name="intent" value="save-availability"/><input type="hidden" name="artistProfileId" value={artist.id}/><label>Zona IANA<input name="timeZone" defaultValue={saved?.timeZone??"Europe/Madrid"} required/></label><label>Ventanas<textarea name="windows" defaultValue={saved?saved.windows.map(window=>`${window.weekday},${window.start},${window.end}`).join("\n"):"1,09:00,14:00\n1,15:00,18:00"}/></label><label>Incremento (min)<input name="slotIncrementMinutes" type="number" min="5" max="240" defaultValue={saved?.slotIncrementMinutes??30}/></label><label>Buffer antes<input name="bufferBeforeMinutes" type="number" min="0" max="240" defaultValue={saved?.bufferBeforeMinutes??15}/></label><label>Buffer después<input name="bufferAfterMinutes" type="number" min="0" max="240" defaultValue={saved?.bufferAfterMinutes??15}/></label><button type="submit" disabled={isPendingFor(pending,"availability",artist.id)}>{isPendingFor(pending,"availability",artist.id)?"Guardando reglas…":"Guardar disponibilidad"}</button></Form>
          </section>
          <section className="calendar-form-section" aria-labelledby={`preview-${artist.id}`}>
            <h3 id={`preview-${artist.id}`}>Previsualizar huecos</h3><p>Consulta Google Calendar y los bloqueos vigentes. El resultado es orientativo y no reserva ni confirma.</p>
            <Form method="post" action="?availability=1" className="record-form"><input type="hidden" name="intent" value="preview-availability"/><input type="hidden" name="artistProfileId" value={artist.id}/><label>Desde (UTC)<input name="rangeStart" type="datetime-local" required/></label><label>Hasta (UTC)<input name="rangeEnd" type="datetime-local" required/></label><label>Duración (min)<input name="durationMinutes" type="number" min="15" max="480" defaultValue="60"/></label><button type="submit" disabled={isPendingFor(pending,"preview",artist.id)}>{isPendingFor(pending,"preview",artist.id)?"Calculando huecos…":"Previsualizar huecos"}</button></Form>
          </section>
          <section className="calendar-form-section" aria-labelledby={`issue-${artist.id}`}>
            <h3 id={`issue-${artist.id}`}>Emitir enlace de elección libre</h3><p>El enlace queda ligado a un caso abierto. Los huecos elegidos requieren decisión del estudio.</p>
            <Form method="post" action="?freeChoice=1" className="record-form"><input type="hidden" name="artistProfileId" value={artist.id}/><label>Caso abierto asignado<select name="tattooCaseId" required><option value="">Selecciona un caso</option>{assignedCases.map(item=><option key={item.id} value={item.id}>{item.summary}</option>)}</select></label><label>Rango desde (UTC)<input name="rangeStart" type="datetime-local" required/></label><label>Rango hasta (UTC)<input name="rangeEnd" type="datetime-local" required/></label><label>Duración (min)<input name="durationMinutes" type="number" min="15" max="480" defaultValue="60"/></label><label>Enlace válido hasta (UTC)<input name="expiresAt" type="datetime-local" required/></label><button type="submit" disabled={assignedCases.length===0||isPendingFor(pending,"issue",artist.id)}>{isPendingFor(pending,"issue",artist.id)?"Emitiendo enlace…":"Emitir o rotar enlace del caso"}</button></Form>
            {assignedCases.length===0?<p className="meta-line">No hay un caso abierto asignado a este artista; por eso no se puede emitir un enlace.</p>:null}
          </section>
        </div>
      </details>;
    })}
    {actionData?.slots!==undefined?<section className="shell-panel preview-result" aria-labelledby="preview-result-title"><h2 id="preview-result-title">Resultado de la previsualización</h2><p>Los intervalos usan la hora local guardada para el artista y añaden la referencia UTC; previsualizar no confirma una cita.</p>{actionData.slots.length===0?<EmptyState title="No hay huecos candidatos en este rango">Ajusta el rango o revisa las reglas y la ocupación en Google Calendar.</EmptyState>:<ol className="slot-list">{actionData.slots.map(slot=><li key={`${slot.startUtc}-${slot.endUtc}`}><span><time dateTime={slot.startUtc}>{humanLocal(slot.startLocal)}</time> — <time dateTime={slot.endUtc}>{humanLocal(slot.endLocal)}</time></span><span className="meta-line">UTC: {humanUtc(slot.startUtc)} — {humanUtc(slot.endUtc)}</span></li>)}</ol>}</section>:null}
  </section>;
}

export function calendarPendingMutation(formData?:FormData,formAction?:string):CalendarPending|null {
  if(!formData)return null;
  const intent=textField(formData,"intent");
  const targetId=textField(formData,"requestId")??textField(formData,"artistProfileId")??undefined;
  const params=new URL(formAction??"/app/owner/calendars","https://app.inkendar.invalid").searchParams;
  if(params.get("freeChoiceDecision")==="1")return {kind:"decision",targetId,intent:intent??undefined};
  if(params.get("freeChoice")==="1")return {kind:"issue",targetId};
  if(params.get("availability")==="1")return {kind:intent==="preview-availability"?"preview":"availability",targetId,intent:intent??undefined};
  if(intent==="assign")return {kind:"assignment",targetId,intent};
  if(intent==="connect"||intent==="disconnect")return {kind:"connection",intent};
  return null;
}

function textField(formData:FormData,name:string):string|null { const value=formData.get(name);return typeof value==="string"?value:null; }
function isPendingFor(pending:CalendarPending|null,kind:CalendarPending["kind"],targetId:string):boolean { return pending?.kind===kind&&pending.targetId===targetId; }
function isWritableCalendar(calendar:GoogleCalendar):boolean { return calendar.accessRole==="writer"||calendar.accessRole==="owner"; }
function calendarOption(calendar:GoogleCalendar):string { return [calendar.summary,calendar.primary?"principal":null,calendar.timeZone??"zona no informada"].filter(Boolean).join(" · "); }
function assignmentDescription(artist:ArtistCalendarAssignment,calendar:GoogleCalendar|undefined):string {
  if(!artist.calendarId)return "Este artista aún no tiene calendario operativo.";
  if(!calendar)return "La asignación guardada no aparece en la lista actual de Google. Revísala antes de guardar cambios.";
  if(!isWritableCalendar(calendar))return `${calendar.summary} no permite gestionar los detalles privados necesarios. Elige un calendario compatible.`;
  return `Asignado a ${calendar.summary}${calendar.primary?" (principal)":""}. Zona: ${calendar.timeZone??"no informada"}. Acceso: ${calendar.accessRole}.`;
}
function connectionPresentation(status:CalendarView["connectionStatus"]):Readonly<{badge:string;description:string;tone:"success"|"warning"|"neutral"}> {
  if(status==="ACTIVE")return {badge:"Conectado",description:"Conexión configurada. Puedes reconectar para renovar permisos o desconectar la cuenta del estudio.",tone:"success"};
  if(status==="REAUTH_REQUIRED")return {badge:"Reautorización necesaria",description:"Google ya no permite operar con estas credenciales. Vuelve a autorizar antes de consultar disponibilidad o confirmar citas.",tone:"warning"};
  return {badge:"Sin conexión",description:"Google Calendar no está conectado. Conecta la cuenta operativa del estudio para continuar.",tone:"neutral"};
}
const utcFormatter=new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"});
function humanUtc(value:string):string { const parsed=new Date(value);return Number.isNaN(parsed.getTime())?`${value} UTC`:`${utcFormatter.format(parsed)} UTC`; }
function humanLocal(value:string):string {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if(!match)return value;
  const [,year,month,day,hour,minute]=match;
  return utcFormatter.format(new Date(Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute))));
}
