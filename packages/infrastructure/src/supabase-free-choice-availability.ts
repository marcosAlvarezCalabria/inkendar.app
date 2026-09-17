import { createClient } from "@supabase/supabase-js";
import { FreeChoiceAvailabilityContextNotFoundError,type FreeChoiceAvailabilityAccessRepositoryPort,type PublicFreeChoiceAvailabilityContext,type PublicFreeChoiceAvailabilityRepositoryPort,type RotateFreeChoiceAvailabilityAccessRecord } from "@inkendar/application";
import { normalizePublicBookingOfferHash } from "@inkendar/domain";

type Result=Readonly<{data:unknown;error:unknown}>;
export interface FreeChoiceAvailabilityDataGateway { rotateAccess(parameters:Record<string,unknown>):Promise<Result>; getPublicContext(parameters:Record<string,unknown>):Promise<Result>; markReauthRequired(parameters:Record<string,unknown>):Promise<Result>; }

export class SupabaseFreeChoiceAvailabilityAccessRepository implements FreeChoiceAvailabilityAccessRepositoryPort {
  constructor(private readonly data:FreeChoiceAvailabilityDataGateway,private readonly ownerUserId:string){}
  async rotateAccess(input:RotateFreeChoiceAvailabilityAccessRecord):Promise<Readonly<{expiresAt:string}>>{
    const result=await this.data.rotateAccess({p_studio_id:input.studioId,p_owner_user_id:this.ownerUserId,p_artist_profile_id:input.artistProfileId,p_token_hash:normalizePublicBookingOfferHash(input.tokenHash),p_range_start:input.rangeStart,p_range_end:input.rangeEnd,p_duration_minutes:input.durationMinutes,p_expires_at:input.expiresAt,p_now:input.nowUtc});
    if(result.error||result.data===null)ownerFailed(result.error);
    return {expiresAt:timestamp(object(result.data).expires_at)};
  }
}

export class SupabasePublicFreeChoiceAvailabilityRepository implements PublicFreeChoiceAvailabilityRepositoryPort {
  constructor(private readonly data:FreeChoiceAvailabilityDataGateway){}
  async getContextByTokenHash(input:Readonly<{tokenHash:string;nowUtc:string}>):Promise<PublicFreeChoiceAvailabilityContext|null>{
    const result=await this.data.getPublicContext({p_token_hash:normalizePublicBookingOfferHash(input.tokenHash),p_now:input.nowUtc});
    if(result.error)failed(); if(result.data===null)return null; const row=object(result.data),connection=object(row.connection);
    return {rangeStart:timestamp(row.range_start),rangeEnd:timestamp(row.range_end),durationMinutes:integer(row.duration_minutes),expiresAt:timestamp(row.expires_at),artistDisplayName:bounded(row.artist_display_name,120),rules:{timeZone:bounded(row.time_zone,128),slotIncrementMinutes:integer(row.slot_increment_minutes),bufferBeforeMinutes:integer(row.buffer_before_minutes),bufferAfterMinutes:integer(row.buffer_after_minutes),windows:array(row.windows).map(value=>{const window=object(value);return {weekday:integer(window.weekday),start:bounded(window.start_time,5).slice(0,5),end:bounded(window.end_time,5).slice(0,5)};})},calendarId:bounded(row.calendar_id,1024),connection:{status:status(connection.status),encryptedRefreshToken:nullable(connection.refresh_token_ciphertext,8192),grantedScopes:array(connection.granted_scopes).map(value=>bounded(value,512)),credentialGeneration:positive(connection.credential_generation)},holds:array(row.holds).map(value=>{const hold=object(value);return {startUtc:timestamp(hold.start_at),endUtc:timestamp(hold.end_at)};})};
  }
  async markReauthRequired(input:Readonly<{tokenHash:string;credentialGeneration:number;nowUtc:string}>):Promise<void>{const result=await this.data.markReauthRequired({p_token_hash:normalizePublicBookingOfferHash(input.tokenHash),p_credential_generation:input.credentialGeneration,p_now:input.nowUtc});if(result.error)failed();}
}

export class SupabaseFreeChoiceAvailabilityGateway implements FreeChoiceAvailabilityDataGateway { constructor(private readonly rpc:(name:string,parameters:Record<string,unknown>)=>Promise<Result>){} rotateAccess=(parameters:Record<string,unknown>)=>this.rpc("rotate_free_choice_availability_access",parameters);getPublicContext=(parameters:Record<string,unknown>)=>this.rpc("get_public_free_choice_availability_context",parameters);markReauthRequired=(parameters:Record<string,unknown>)=>this.rpc("mark_public_free_choice_availability_reauth_required",parameters); }
export function createSupabaseFreeChoiceAvailabilityAccessRepository(environment:Record<string,string|undefined>,ownerUserId:string){return new SupabaseFreeChoiceAvailabilityAccessRepository(gateway(environment),ownerUserId);}
export function createSupabasePublicFreeChoiceAvailabilityRepository(environment:Record<string,string|undefined>){return new SupabasePublicFreeChoiceAvailabilityRepository(gateway(environment));}
function gateway(environment:Record<string,string|undefined>){const url=environment.SUPABASE_URL?.trim(),key=environment.SUPABASE_SERVICE_ROLE_KEY?.trim();if(!url||!key)failed();const client=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});return new SupabaseFreeChoiceAvailabilityGateway(async(name,parameters)=>{const {data,error}=await client.rpc(name,parameters);return {data,error};});}
function ownerFailed(error:unknown):never{const code=typeof error==="object"&&error!==null&&"code" in error?error.code:null;if(code==="P0002"||code==="22023")throw new FreeChoiceAvailabilityContextNotFoundError();failed();}
function failed():never{throw new Error("Free-choice availability persistence failed");}
function object(value:unknown):Record<string,unknown>{if(typeof value!=="object"||value===null||Array.isArray(value))failed();return value as Record<string,unknown>;}
function array(value:unknown):unknown[]{if(!Array.isArray(value))failed();return value;}
function bounded(value:unknown,max:number):string{if(typeof value!=="string"||value.length<1||value.length>max)failed();return value;}
function nullable(value:unknown,max:number):string|null{return value===null?null:bounded(value,max);}
function integer(value:unknown):number{if(typeof value!=="number"||!Number.isSafeInteger(value))failed();return value;}
function positive(value:unknown):number{const result=integer(value);if(result<1)failed();return result;}
function timestamp(value:unknown):string{if(typeof value!=="string")failed();const date=new Date(value);if(!Number.isFinite(date.getTime()))failed();return date.toISOString();}
function status(value:unknown):"ACTIVE"|"REAUTH_REQUIRED"|"DISCONNECTED"{if(value!=="ACTIVE"&&value!=="REAUTH_REQUIRED"&&value!=="DISCONNECTED")failed();return value;}
