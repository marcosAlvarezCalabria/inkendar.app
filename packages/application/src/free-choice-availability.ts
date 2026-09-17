import {
  PUBLIC_BOOKING_OFFER_TOKEN_BYTES,
  InvalidPublicBookingOfferTokenError,
  candidateSlots,
  encodePublicBookingOfferToken,
  normalizeBookingResourceId,
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
export type RotateFreeChoiceAvailabilityAccessRecord = FreeChoiceAvailabilityAccess & Readonly<{ studioId:string; artistProfileId:string; tokenHash:string; nowUtc:string }>;
export type PublicFreeChoiceAvailabilityContext = FreeChoiceAvailabilityAccess & Readonly<{
  artistDisplayName:string;
  rules:AvailabilityRules;
  calendarId:string;
  connection:Readonly<{ status:GoogleConnectionStatus; encryptedRefreshToken:string|null; grantedScopes:readonly string[]; credentialGeneration:number }>;
  holds:readonly BusyInterval[];
}>;
export type PublicFreeChoiceAvailabilityView = FreeChoiceAvailabilityAccess & Readonly<{ artistDisplayName:string; timeZone:string; slots:readonly AvailabilitySlot[] }>;

export interface FreeChoiceAvailabilityAccessRepositoryPort { rotateAccess(input:RotateFreeChoiceAvailabilityAccessRecord):Promise<Readonly<{expiresAt:string}>>; }
export interface PublicFreeChoiceAvailabilityRepositoryPort {
  getContextByTokenHash(input:Readonly<{tokenHash:string;nowUtc:string}>):Promise<PublicFreeChoiceAvailabilityContext|null>;
  markReauthRequired(input:Readonly<{tokenHash:string;credentialGeneration:number;nowUtc:string}>):Promise<void>;
}

export class FreeChoiceAvailabilityUnavailableError extends Error { readonly code="FREE_CHOICE_AVAILABILITY_UNAVAILABLE"; constructor(){super("Free-choice availability is unavailable");this.name="FreeChoiceAvailabilityUnavailableError";} }
export class FreeChoiceAvailabilityContextNotFoundError extends Error { readonly code="FREE_CHOICE_AVAILABILITY_CONTEXT_NOT_FOUND"; constructor(){super("Free-choice availability context is unavailable");this.name="FreeChoiceAvailabilityContextNotFoundError";} }

type Dependencies=Readonly<{ownerRepository:FreeChoiceAvailabilityAccessRepositoryPort;publicRepository:PublicFreeChoiceAvailabilityRepositoryPort;provider:GoogleFreeBusyPort;tokens:GoogleTokenProtectorPort;randomBytes(size:number):Uint8Array;hashToken(token:string):string;clock?:()=>Date}>;

export function createFreeChoiceAvailabilityService(dependencies:Dependencies){
  const now=()=>{const value=(dependencies.clock??(()=>new Date()))();if(!Number.isFinite(value.getTime()))throw new Error("Server clock is invalid");return value.toISOString();};
  return {
    async issue(studioIdValue:string,artistProfileIdValue:string,access:FreeChoiceAvailabilityAccess):Promise<Readonly<{token:string;expiresAt:string}>>{
      const nowUtc=now();
      validateFreeChoiceAvailabilityAccess({...access,nowUtc});
      const token=encodePublicBookingOfferToken(dependencies.randomBytes(PUBLIC_BOOKING_OFFER_TOKEN_BYTES));
      const tokenHash=normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const result=await dependencies.ownerRepository.rotateAccess({studioId:normalizeBookingResourceId(studioIdValue),artistProfileId:normalizeBookingResourceId(artistProfileIdValue),tokenHash,...access,nowUtc});
      return {token,expiresAt:result.expiresAt};
    },
    async getPublic(rawToken:string):Promise<PublicFreeChoiceAvailabilityView>{
      let token:string;
      try{token=normalizePublicBookingOfferToken(rawToken);}catch(error){if(error instanceof InvalidPublicBookingOfferTokenError)throw new FreeChoiceAvailabilityUnavailableError();throw error;}
      const tokenHash=normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const nowUtc=now();
      const context=await dependencies.publicRepository.getContextByTokenHash({tokenHash,nowUtc});
      if(!context||context.connection.status!=="ACTIVE"||!context.connection.encryptedRefreshToken||!context.connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE))throw new FreeChoiceAvailabilityUnavailableError();
      try{validateRules(context.rules);validateFreeChoiceAvailabilityAccess({rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,expiresAt:context.expiresAt,nowUtc,allowStartedRange:true});}catch{throw new FreeChoiceAvailabilityUnavailableError();}
      let busy:readonly BusyInterval[];
      try{busy=await dependencies.provider.queryBusy(dependencies.tokens.decrypt(context.connection.encryptedRefreshToken),{calendarId:context.calendarId,timeMin:context.rangeStart,timeMax:context.rangeEnd});}
      catch(error){if(error instanceof AvailabilityCredentialInvalidError){await dependencies.publicRepository.markReauthRequired({tokenHash,credentialGeneration:context.connection.credentialGeneration,nowUtc});throw new FreeChoiceAvailabilityUnavailableError();}throw new AvailabilityProviderUnavailableError();}
      return {rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,expiresAt:context.expiresAt,artistDisplayName:context.artistDisplayName,timeZone:context.rules.timeZone,slots:candidateSlots({rules:context.rules,rangeStart:context.rangeStart,rangeEnd:context.rangeEnd,durationMinutes:context.durationMinutes,busy:[...busy,...context.holds]})};
    },
  };
}
