import { AvailabilityCredentialInvalidError, AvailabilityProviderUnavailableError, type GoogleFreeBusyPort } from "@inkendar/application";
import type { BusyInterval } from "@inkendar/domain";
import type { GoogleCalendarConfig } from "./google-calendar.js";
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
const TOKEN="https://oauth2.googleapis.com/token", FREE_BUSY="https://www.googleapis.com/calendar/v3/freeBusy";
export class GoogleFreeBusyHttpAdapter implements GoogleFreeBusyPort {
 constructor(private readonly config:GoogleCalendarConfig,private readonly fetcher:Fetcher=fetch){}
 async queryBusy(refreshToken:string,input:Readonly<{calendarId:string;timeMin:string;timeMax:string}>):Promise<readonly BusyInterval[]>{
  const tokenResponse=await this.fetcher(TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"}),signal:AbortSignal.timeout(8_000)});
  const token=await payload(tokenResponse,true); const access=required(token.access_token);
  const response=await this.fetcher(FREE_BUSY,{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({timeMin:input.timeMin,timeMax:input.timeMax,timeZone:"UTC",items:[{id:input.calendarId}]}),signal:AbortSignal.timeout(8_000)});
  const data=await payload(response,false); const calendars=record(data.calendars); const calendar=record(calendars[input.calendarId]); if(Array.isArray(calendar.errors)&&calendar.errors.length) throw new AvailabilityProviderUnavailableError(); if(!Array.isArray(calendar.busy)||calendar.busy.length>10_000) throw new AvailabilityProviderUnavailableError();
  return calendar.busy.map((value)=>{const row=record(value);const start=new Date(required(row.start)),end=new Date(required(row.end));if(!Number.isFinite(start.getTime())||!(end>start))throw new AvailabilityProviderUnavailableError();return {startUtc:start.toISOString(),endUtc:end.toISOString()};});
 }
}
async function payload(response:Response,refresh:boolean):Promise<Record<string,unknown>>{let value:unknown;try{value=await response.json();}catch{throw new AvailabilityProviderUnavailableError();}const result=record(value);if(!response.ok){if(refresh&&result.error==="invalid_grant")throw new AvailabilityCredentialInvalidError();throw new AvailabilityProviderUnavailableError();}return result;}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new AvailabilityProviderUnavailableError();return value as Record<string,unknown>;}
function required(value:unknown):string{if(typeof value!=="string"||!value)throw new AvailabilityProviderUnavailableError();return value;}
