import {isBookingIntervalFree,normalizeBookingConfirmationInterval,normalizeBookingResourceId,type BookingConfirmationInterval} from "@inkendar/domain";
import {AvailabilityCredentialInvalidError,AvailabilityProviderUnavailableError,GOOGLE_FREE_BUSY_SCOPE,type GoogleFreeBusyPort} from "./availability.js";
import {BOOKING_EVENT_SUMMARY,BookingConfirmationConflictError,BookingConfirmationCredentialInvalidError,BookingConfirmationMismatchError,BookingConfirmationProviderUnavailableError,BookingConfirmationReconnectRequiredError,GOOGLE_CALENDAR_EVENTS_SCOPE,type BookingCalendarEvent,type BookingConfirmationConnection,type BookingEventIdentity,type BookingEventIdentityPort,type GoogleBookingEventPort} from "./booking-confirmation.js";
import type {GoogleTokenProtectorPort} from "./google-calendar.js";

export type FreeChoiceApprovalClaim=
 | Readonly<{kind:"BUSY"|"CONFLICT"|"RECONNECT_REQUIRED"|"UNAVAILABLE"}>
 | (BookingConfirmationInterval&BookingEventIdentity&Readonly<{kind:"CLAIMED";mode:"INSERT_OR_RECONCILE"|"RECONCILE_ONLY";leaseId:string;studioId:string;requestId:string;calendarId:string;connection:BookingConfirmationConnection;finalized:(BookingEventIdentity&Readonly<{confirmedAt:string}>)|null}>);
export interface FreeChoiceOwnerDecisionRepositoryPort{
 claim(input:Readonly<{studioId:string;ownerUserId:string;requestId:string;eventId:string;correlation:string;nowUtc:string}>):Promise<FreeChoiceApprovalClaim>;
 beginInsert(input:Readonly<{studioId:string;ownerUserId:string;requestId:string;leaseId:string;nowUtc:string}>):Promise<boolean>;
 releaseClaim(input:Readonly<{studioId:string;ownerUserId:string;requestId:string;leaseId:string;nowUtc:string}>):Promise<void>;
 finalize(input:Readonly<{studioId:string;ownerUserId:string;requestId:string;leaseId:string;connectionId:string;calendarId:string;eventId:string;correlation:string;nowUtc:string}>):Promise<Readonly<{confirmedAt:string}>>;
 reject(input:Readonly<{studioId:string;ownerUserId:string;requestId:string;nowUtc:string}>):Promise<Readonly<{state:"REJECTED"}>>;
 markReauthRequired(studioId:string,connectionId:string,credentialGeneration:number):Promise<void>;
}
type Actor=Readonly<{studioId:string;ownerUserId:string;requestId:string}>;
type Dependencies=Readonly<{repository:FreeChoiceOwnerDecisionRepositoryPort;events:GoogleBookingEventPort;freeBusy:GoogleFreeBusyPort;tokens:GoogleTokenProtectorPort;identity:BookingEventIdentityPort;clock?:()=>Date}>;
export function createFreeChoiceOwnerDecisionService(d:Dependencies){
 const at=()=>{const value=(d.clock??(()=>new Date()))();if(!Number.isFinite(value.getTime()))throw new BookingConfirmationProviderUnavailableError();return value.toISOString();};
 const actor=(input:Actor)=>({studioId:normalizeBookingResourceId(input.studioId),ownerUserId:normalizeBookingResourceId(input.ownerUserId),requestId:normalizeBookingResourceId(input.requestId)});
 return {
  reject(input:Actor){return d.repository.reject({...actor(input),nowUtc:at()});},
  async approve(input:Actor):Promise<Readonly<{state:"CONFIRMED";confirmedAt:string}>>{
   const who=actor(input),nowUtc=at(),proposed=d.identity.create(who.requestId),claim=await d.repository.claim({...who,...proposed,nowUtc});
   if(claim.kind==="RECONNECT_REQUIRED")throw new BookingConfirmationReconnectRequiredError();
   if(claim.kind==="CONFLICT")throw new BookingConfirmationConflictError();
   if(claim.kind==="BUSY")throw new BookingConfirmationProviderUnavailableError();
   if(claim.kind==="UNAVAILABLE")throw new BookingConfirmationMismatchError();
   if(claim.kind!=="CLAIMED")throw new BookingConfirmationMismatchError();
   if(claim.requestId!==who.requestId||claim.studioId!==who.studioId||claim.eventId!==proposed.eventId||claim.correlation!==proposed.correlation)throw new BookingConfirmationMismatchError();
   const selected=normalizeBookingConfirmationInterval(claim),connection=claim.connection;
   if(connection.status!=="ACTIVE"||!connection.encryptedRefreshToken||!connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE)||!connection.grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE))throw new BookingConfirmationReconnectRequiredError();
   const refresh=d.tokens.decrypt(connection.encryptedRefreshToken),existing=await read(refresh,claim,d,who,nowUtc);
   if(existing)return finish(existing,claim,selected,d.repository,who,nowUtc);
   if(claim.mode==="RECONCILE_ONLY"||claim.finalized)throw new BookingConfirmationMismatchError();
   let busy;
   try{busy=await d.freeBusy.queryBusy(refresh,{calendarId:claim.calendarId,timeMin:selected.startUtc,timeMax:selected.endUtc});}
   catch(error){await d.repository.releaseClaim({...who,leaseId:claim.leaseId,nowUtc});if(error instanceof AvailabilityCredentialInvalidError){await d.repository.markReauthRequired(claim.studioId,connection.id,connection.credentialGeneration);throw new BookingConfirmationReconnectRequiredError();}if(error instanceof AvailabilityProviderUnavailableError)throw new BookingConfirmationProviderUnavailableError();throw error;}
   if(!isBookingIntervalFree(selected,busy)){await d.repository.releaseClaim({...who,leaseId:claim.leaseId,nowUtc});throw new BookingConfirmationConflictError();}
   if(!await d.repository.beginInsert({...who,leaseId:claim.leaseId,nowUtc}))throw new BookingConfirmationProviderUnavailableError();
   try{const inserted=await d.events.insertEvent(refresh,{calendarId:claim.calendarId,...proposed,...selected,summary:BOOKING_EVENT_SUMMARY});return finish(inserted,claim,selected,d.repository,who,nowUtc);}
   catch(error){if(error instanceof BookingConfirmationCredentialInvalidError){await d.repository.markReauthRequired(claim.studioId,connection.id,connection.credentialGeneration);throw new BookingConfirmationReconnectRequiredError();}const reconciled=await read(refresh,claim,d,who,nowUtc);if(!reconciled)throw new BookingConfirmationProviderUnavailableError();return finish(reconciled,claim,selected,d.repository,who,nowUtc);}
  }
 };
}
async function read(refresh:string,claim:Extract<FreeChoiceApprovalClaim,{kind:"CLAIMED"}>,d:Dependencies,who:Actor,nowUtc:string){try{return await d.events.getEvent(refresh,{calendarId:claim.calendarId,eventId:claim.eventId});}catch(error){if(error instanceof BookingConfirmationCredentialInvalidError){await d.repository.releaseClaim({...who,leaseId:claim.leaseId,nowUtc});await d.repository.markReauthRequired(claim.studioId,claim.connection.id,claim.connection.credentialGeneration);throw new BookingConfirmationReconnectRequiredError();}throw new BookingConfirmationProviderUnavailableError();}}
async function finish(event:BookingCalendarEvent,claim:Extract<FreeChoiceApprovalClaim,{kind:"CLAIMED"}>,selected:BookingConfirmationInterval,repository:FreeChoiceOwnerDecisionRepositoryPort,who:Actor,nowUtc:string){if((claim.finalized&&(claim.finalized.eventId!==claim.eventId||claim.finalized.correlation!==claim.correlation))||event.id!==claim.eventId||event.startUtc!==selected.startUtc||event.endUtc!==selected.endUtc||event.status!=="confirmed"||event.summary!==BOOKING_EVENT_SUMMARY||event.transparency!=="opaque"||event.visibility!=="private"||event.correlation!==claim.correlation||event.attendeeCount!==0)throw new BookingConfirmationMismatchError();const result=await repository.finalize({...who,leaseId:claim.leaseId,connectionId:claim.connection.id,calendarId:claim.calendarId,eventId:claim.eventId,correlation:claim.correlation,nowUtc});return {state:"CONFIRMED" as const,confirmedAt:result.confirmedAt};}
