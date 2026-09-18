import {
  PUBLIC_BOOKING_OFFER_TOKEN_BYTES,
  InvalidPublicBookingOfferTokenError,
  candidateSlots,
  encodePublicBookingOfferToken,
  normalizeBookingResourceId,
  normalizeFreeChoiceSlotSelector,
  normalizePublicBookingOfferHash,
  normalizePublicBookingOfferToken,
  validateFreeChoiceAvailabilityAccess,
  validateRules,
  type AvailabilityRules,
  type AvailabilitySlot,
  type BusyInterval,
} from "@inkendar/domain";
import { AvailabilityCredentialInvalidError, AvailabilityProviderUnavailableError, GOOGLE_FREE_BUSY_SCOPE, type GoogleFreeBusyPort } from "./availability.js";
import type { GoogleConnectionStatus, GoogleTokenProtectorPort } from "./google-calendar.js";

export type FreeChoiceAvailabilityAccess = Readonly<{ rangeStart:string; rangeEnd:string; durationMinutes:number; expiresAt:string }>;
export type RotateFreeChoiceAvailabilityAccessRecord = FreeChoiceAvailabilityAccess & Readonly<{ studioId:string; tattooCaseId:string; artistProfileId:string; tokenHash:string; nowUtc:string }>;
export type FreeChoicePendingRequest = Readonly<{state:"PENDING_OWNER_APPROVAL";startUtc:string;endUtc:string;expiresAt:string}>;
export type PublicFreeChoiceAvailabilityContext = FreeChoiceAvailabilityAccess & Readonly<{
  caseBound:boolean;
  artistDisplayName:string;
  rules:AvailabilityRules;
  calendarId:string;
  connection:Readonly<{ status:GoogleConnectionStatus; encryptedRefreshToken:string|null; grantedScopes:readonly string[]; credentialGeneration:number }>;
  holds:readonly BusyInterval[];
  pendingRequest:FreeChoicePendingRequest|null;
}>;
export type PublicFreeChoiceRequestStatus =
  | Readonly<{state:"PENDING_OWNER_APPROVAL"|"CONFIRMED";startUtc:string;endUtc:string}>
  | Readonly<{state:"APPROVING"|"REJECTED"|"EXPIRED"}>;
export type PublicFreeChoiceAvailabilityView =
  | (FreeChoiceAvailabilityAccess & Readonly<{state:"OPEN";artistDisplayName:string;timeZone:string;slots:readonly (AvailabilitySlot & {selector:string})[]}>)
  | Readonly<{state:"PENDING_OWNER_APPROVAL"|"CONFIRMED";selectedSlot:Pick<AvailabilitySlot,"startUtc"|"endUtc">}>
  | Readonly<{state:"APPROVING"|"REJECTED"|"EXPIRED"}>;
export type FreeChoiceOwnerManagement=Readonly<{cases:readonly {id:string;summary:string;artistProfileId:string}[];pendingRequests:readonly {id:string;status:"PENDING_OWNER_APPROVAL"|"APPROVING";customerName:string;caseSummary:string;artistDisplayName:string;startUtc:string;endUtc:string;expiresAt:string}[]}>;

export interface FreeChoiceAvailabilityAccessRepositoryPort { rotateAccess(input:RotateFreeChoiceAvailabilityAccessRecord):Promise<Readonly<{expiresAt:string}>>;getManagement(studioId:string):Promise<FreeChoiceOwnerManagement>; }
export interface PublicFreeChoiceAvailabilityRepositoryPort {
  getRequestStatusByTokenHash(input:Readonly<{tokenHash:string;nowUtc:string}>):Promise<PublicFreeChoiceRequestStatus|null>;
  getContextByTokenHash(input:Readonly<{tokenHash:string;nowUtc:string}>):Promise<PublicFreeChoiceAvailabilityContext|null>;
  markReauthRequired(input:Readonly<{tokenHash:string;credentialGeneration:number;nowUtc:string}>):Promise<void>;
  selectPending(input:Readonly<{tokenHash:string;selector:string;startUtc:string;endUtc:string;nowUtc:string}>):Promise<FreeChoicePendingRequest>;
}

export class FreeChoiceAvailabilityUnavailableError extends Error { readonly code="FREE_CHOICE_AVAILABILITY_UNAVAILABLE"; constructor(){super("Free-choice availability is unavailable");this.name="FreeChoiceAvailabilityUnavailableError";} }
export class FreeChoiceAvailabilityContextNotFoundError extends Error { readonly code="FREE_CHOICE_AVAILABILITY_CONTEXT_NOT_FOUND"; constructor(){super("Free-choice availability context is unavailable");this.name="FreeChoiceAvailabilityContextNotFoundError";} }

type Dependencies=Readonly<{ownerRepository:FreeChoiceAvailabilityAccessRepositoryPort;publicRepository:PublicFreeChoiceAvailabilityRepositoryPort;provider:GoogleFreeBusyPort;tokens:GoogleTokenProtectorPort;randomBytes(size:number):Uint8Array;hashToken(token:string):string;clock?:()=>Date}>;

export function createFreeChoiceAvailabilityService(dependencies:Dependencies){
  const now=()=>{const value=(dependencies.clock??(()=>new Date()))();if(!Number.isFinite(value.getTime()))throw new Error("Server clock is invalid");return value.toISOString();};
  return {
    management:(studioId:string)=>dependencies.ownerRepository.getManagement(normalizeBookingResourceId(studioId)),
    async issue(studioIdValue:string,tattooCaseIdValue:string,artistProfileIdValue:string,access:FreeChoiceAvailabilityAccess):Promise<Readonly<{token:string;expiresAt:string}>>{
      const nowUtc=now();
      validateFreeChoiceAvailabilityAccess({...access,nowUtc});
      const token=encodePublicBookingOfferToken(dependencies.randomBytes(PUBLIC_BOOKING_OFFER_TOKEN_BYTES));
      const tokenHash=normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const result=await dependencies.ownerRepository.rotateAccess({studioId:normalizeBookingResourceId(studioIdValue),tattooCaseId:normalizeBookingResourceId(tattooCaseIdValue),artistProfileId:normalizeBookingResourceId(artistProfileIdValue),tokenHash,...access,nowUtc});
      return {token,expiresAt:result.expiresAt};
    },
    async getPublic(rawToken:string):Promise<PublicFreeChoiceAvailabilityView>{
      let token:string;
      try{token=normalizePublicBookingOfferToken(rawToken);}catch(error){if(error instanceof InvalidPublicBookingOfferTokenError)throw new FreeChoiceAvailabilityUnavailableError();throw error;}
      const tokenHash=normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const nowUtc=now();
      const status=await dependencies.publicRepository.getRequestStatusByTokenHash({tokenHash,nowUtc});
      if(status)return terminalView(status);
      const context=await dependencies.publicRepository.getContextByTokenHash({tokenHash,nowUtc});
      if(!context||context.connection.status!=="ACTIVE"||!context.connection.encryptedRefreshToken||!context.connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE))throw new FreeChoiceAvailabilityUnavailableError();
      try{validateRules(context.rules);validateFreeChoiceAvailabilityAccess({rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,expiresAt:context.expiresAt,nowUtc,allowStartedRange:true});}catch{throw new FreeChoiceAvailabilityUnavailableError();}
      if(context.pendingRequest)return pendingView(context,context.pendingRequest);
      let busy:readonly BusyInterval[];
      try{busy=await dependencies.provider.queryBusy(dependencies.tokens.decrypt(context.connection.encryptedRefreshToken),{calendarId:context.calendarId,timeMin:context.rangeStart,timeMax:context.rangeEnd});}
      catch(error){if(error instanceof AvailabilityCredentialInvalidError){await dependencies.publicRepository.markReauthRequired({tokenHash,credentialGeneration:context.connection.credentialGeneration,nowUtc});throw new FreeChoiceAvailabilityUnavailableError();}throw new AvailabilityProviderUnavailableError();}
      return {state:"OPEN",rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,expiresAt:context.expiresAt,artistDisplayName:context.artistDisplayName,timeZone:context.rules.timeZone,slots:candidateSlots({rules:context.rules,rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,busy:[...busy,...context.holds]}).map(slot=>({...slot,selector:slotSelector(token,slot,dependencies.hashToken)}))};
    },
    async selectPublic(rawToken:string,rawSelector:string):Promise<PublicFreeChoiceAvailabilityView>{
      let token:string,selector:string;try{token=normalizePublicBookingOfferToken(rawToken);selector=normalizeFreeChoiceSlotSelector(rawSelector);}catch{throw new FreeChoiceAvailabilityUnavailableError();}
      const tokenHash=normalizePublicBookingOfferHash(dependencies.hashToken(token)),nowUtc=now(),context=await dependencies.publicRepository.getContextByTokenHash({tokenHash,nowUtc});
      if(!context||!context.caseBound||context.connection.status!=="ACTIVE"||!context.connection.encryptedRefreshToken||!context.connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE))throw new FreeChoiceAvailabilityUnavailableError();
      if(context.pendingRequest){const expected=slotSelector(token,{startUtc:context.pendingRequest.startUtc,endUtc:context.pendingRequest.endUtc},dependencies.hashToken);if(!same(expected,selector))throw new FreeChoiceAvailabilityUnavailableError();return pendingView(context,context.pendingRequest);}
      let busy:readonly BusyInterval[];try{busy=await dependencies.provider.queryBusy(dependencies.tokens.decrypt(context.connection.encryptedRefreshToken),{calendarId:context.calendarId,timeMin:context.rangeStart,timeMax:context.rangeEnd});}catch(error){if(error instanceof AvailabilityCredentialInvalidError){await dependencies.publicRepository.markReauthRequired({tokenHash,credentialGeneration:context.connection.credentialGeneration,nowUtc});throw new FreeChoiceAvailabilityUnavailableError();}throw new AvailabilityProviderUnavailableError();}
      const slot=candidateSlots({rules:context.rules,rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,busy:[...busy,...context.holds]}).find(value=>same(slotSelector(token,value,dependencies.hashToken),selector));if(!slot)throw new FreeChoiceAvailabilityUnavailableError();
      try{return pendingView(context,await dependencies.publicRepository.selectPending({tokenHash,selector,startUtc:slot.startUtc,endUtc:slot.endUtc,nowUtc}));}catch{throw new FreeChoiceAvailabilityUnavailableError();}
    },
  };
}

function slotSelector(token:string,slot:Pick<AvailabilitySlot,"startUtc"|"endUtc">&Partial<Pick<AvailabilitySlot,"startLocal"|"endLocal">>,hash:(value:string)=>string){return normalizePublicBookingOfferHash(hash(`free-choice-slot:v1:${token}:${slot.startUtc}:${slot.endUtc}`));}
function same(left:string,right:string){if(left.length!==right.length)return false;let difference=0;for(let i=0;i<left.length;i+=1)difference|=left.charCodeAt(i)^right.charCodeAt(i);return difference===0;}
function pendingView(_context:PublicFreeChoiceAvailabilityContext,pending:FreeChoicePendingRequest):PublicFreeChoiceAvailabilityView{return {state:"PENDING_OWNER_APPROVAL",selectedSlot:{startUtc:pending.startUtc,endUtc:pending.endUtc}};}
function terminalView(status:PublicFreeChoiceRequestStatus):PublicFreeChoiceAvailabilityView{return status.state==="PENDING_OWNER_APPROVAL"||status.state==="CONFIRMED"?{state:status.state,selectedSlot:{startUtc:status.startUtc,endUtc:status.endUtc}}:{state:status.state};}