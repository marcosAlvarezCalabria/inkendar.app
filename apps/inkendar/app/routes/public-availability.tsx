import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Form, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { PublicFreeChoiceAvailabilityView as PublicAvailabilityData } from "@inkendar/application";
import type { Route } from "./+types/public-availability";
import { publicFreeChoiceAvailabilityHandlers,publicFreeChoiceAvailabilityHeaders } from "../free-choice-availability.server.js";
import { EmptyState, Notice } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { PublicHeading, PublicInterval, PublicMeta, PublicState } from "../ui/public-booking.js";
import { PublicLinkShell } from "../ui/shells.js";

export function meta():Route.MetaDescriptors{return [{title:"Huecos disponibles | Inkendar"},{name:"robots",content:"noindex,nofollow"},{name:"referrer",content:"no-referrer"}];}
export function headers(){return Object.fromEntries(publicFreeChoiceAvailabilityHeaders());}
export async function loader({request,params}:Route.LoaderArgs){const response=await publicFreeChoiceAvailabilityHandlers.loader(request,params.token);if(!response.ok)throw new Response(response.status===503?"La disponibilidad no está disponible temporalmente.":"Este enlace no está disponible.",{status:response.status,headers:publicFreeChoiceAvailabilityHeaders()});return response;}
export default function PublicFreeChoiceAvailability(){
 const data=useLoaderData() as PublicAvailabilityData;
 const [pendingSelector,setPendingSelector]=useState<string|null>(null);
 const submitting=useRef(false);
 function beginDocumentSubmission(selector:string,event:FormEvent<HTMLFormElement>){if(submitting.current){event.preventDefault();return;}submitting.current=true;setPendingSelector(selector);}
 return <PublicLinkShell><PublicAvailabilityView data={data} pendingSelector={pendingSelector} onSubmit={beginDocumentSubmission}/></PublicLinkShell>;
}
export function PublicAvailabilityView({data,pendingSelector=null,onSubmit}:Readonly<{data:PublicAvailabilityData;pendingSelector?:string|null;onSubmit?:((selector:string,event:FormEvent<HTMLFormElement>)=>void)|undefined}>){
 if(data.state==="OPEN")return <OpenAvailability data={data} pendingSelector={pendingSelector} onSubmit={onSubmit}/>;
 if(data.state==="PENDING_OWNER_APPROVAL")return <PublicState title="Solicitud recibida" label="Pendiente de aprobación" tone="pending"><p>Tu elección está pendiente de aprobación. El estudio revisará el hueco que has solicitado; todavía no es una cita confirmada.</p><PublicInterval startUtc={data.selectedSlot.startUtc} endUtc={data.selectedSlot.endUtc} timeZone={null}/><p className="public-footnote">Conserva este enlace para consultar el estado más adelante.</p></PublicState>;
 if(data.state==="APPROVING")return <PublicState title="Solicitud en proceso" label="En comprobación" tone="pending"><p>El estudio está comprobando el resultado y el hueco con el calendario. Todavía no podemos afirmar que exista una cita confirmada.</p><p className="public-footnote">Conserva este enlace y vuelve a consultarlo más adelante.</p></PublicState>;
 if(data.state==="CONFIRMED")return <PublicState title="Cita confirmada" label="Confirmada" tone="success"><p>El estudio ha confirmado tu solicitud en el calendario.</p><PublicInterval startUtc={data.selectedSlot.startUtc} endUtc={data.selectedSlot.endUtc} timeZone={null}/></PublicState>;
 if(data.state==="REJECTED")return <PublicState title="Solicitud no aceptada" label="No aceptada" tone="danger"><p>La solicitud no fue aceptada y no ha sido confirmada. Contacta con el estudio por el canal de siempre si quieres valorar otra fecha.</p></PublicState>;
 return <PublicState title="Solicitud caducada" label="Caducada" tone="neutral"><p>La solicitud ha caducado y ya no está vigente. Pide al estudio un enlace nuevo si quieres solicitar otro hueco.</p></PublicState>;
}

function OpenAvailability({data,pendingSelector,onSubmit}:Readonly<{data:Extract<PublicAvailabilityData,{state:"OPEN"}>;pendingSelector:string|null;onSubmit?:((selector:string,event:FormEvent<HTMLFormElement>)=>void)|undefined}>){return <>
 <PublicHeading title="Huecos disponibles" label="Candidatos disponibles" tone="info"/>
 <p className="public-summary">Estos horarios son candidatos para {data.artistDisplayName}. El estudio debe aprobar tu solicitud antes de que exista una cita.</p>
 <PublicMeta timeZone={data.timeZone} expiresAt={data.expiresAt} expiryLabel="Enlace válido hasta"/>
 <Notice tone="warning" title="La solicitud requiere aprobación"><p>Solicitar un hueco no lo reserva ni lo confirma. El estudio revisará la disponibilidad antes de decidir.</p></Notice>
 {data.slots.length===0?<EmptyState title="No hay huecos para solicitar ahora">El estudio puede compartirte otro enlace con fechas distintas.</EmptyState>:<ol className="public-choice-list" aria-label="Huecos candidatos">{data.slots.map(slot=>{const pending=pendingSelector===slot.selector;return <li key={slot.selector}><Form method="post" action="select" reloadDocument className="slot-choice" onSubmit={onSubmit?(event)=>onSubmit(slot.selector,event):undefined}><input type="hidden" name="selector" value={slot.selector}/><PublicInterval startUtc={slot.startUtc} endUtc={slot.endUtc} timeZone={data.timeZone}/><SubmitButton pending={pending} pendingLabel="Solicitando…">Solicitar este hueco</SubmitButton></Form></li>;})}</ol>}
 </>;}

export function ErrorBoundary(){const error=useRouteError(),temporary=isRouteErrorResponse(error)&&error.status===503;return <PublicLinkShell><PublicHeading title={temporary?"No podemos consultar los huecos ahora":"Este enlace no está disponible"} label={temporary?"Temporal":"No disponible"} tone={temporary?"warning":"neutral"}/><p>{temporary?"El calendario no responde. Inténtalo de nuevo dentro de unos minutos.":"El enlace puede haber caducado o haber sido reemplazado. Pide al estudio un enlace vigente."}</p></PublicLinkShell>;}
