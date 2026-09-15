import { AvailabilityCredentialInvalidError, AvailabilityProviderUnavailableError, type GoogleFreeBusyPort } from "@inkendar/application";
import type { BusyInterval } from "@inkendar/domain";
import type { GoogleCalendarConfig } from "./google-calendar.js";
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
const TOKEN="https://oauth2.googleapis.com/token", FREE_BUSY="https://www.googleapis.com/calendar/v3/freeBusy", MAX_BUSY=10_000, MAX_RESPONSE_BYTES=1_000_000;

export class GoogleFreeBusyHttpAdapter implements GoogleFreeBusyPort {
  constructor(private readonly config:GoogleCalendarConfig,private readonly fetcher:Fetcher=fetch){}
  async queryBusy(refreshToken:string,input:Readonly<{calendarId:string;timeMin:string;timeMax:string}>):Promise<readonly BusyInterval[]>{
    validateInput(input);
    const tokenResponse=await safeFetch(this.fetcher,TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"}),signal:AbortSignal.timeout(8_000)});
    const token=await payload(tokenResponse,true); const access=required(token.access_token);
    const response=await safeFetch(this.fetcher,FREE_BUSY,{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({timeMin:input.timeMin,timeMax:input.timeMax,timeZone:"UTC",items:[{id:input.calendarId}]}),signal:AbortSignal.timeout(8_000)});
    const data=await payload(response,false); const calendars=record(data.calendars); const keys=Object.keys(calendars);
    if(keys.length!==1||keys[0]!==input.calendarId)fail();
    const calendar=record(calendars[input.calendarId]);
    if(calendar.errors!==undefined&&(!Array.isArray(calendar.errors)||calendar.errors.length>0))fail();
    if(!Array.isArray(calendar.busy)||calendar.busy.length>MAX_BUSY)fail();
    return calendar.busy.map((value)=>{const row=record(value);if(Object.keys(row).some((key)=>key!=="start"&&key!=="end"))fail();const start=parseRfc3339(required(row.start)),end=parseRfc3339(required(row.end));if(end<=start)fail();return {startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()};}).sort((a,b)=>a.startUtc.localeCompare(b.startUtc));
  }
}

function validateInput(input:Readonly<{calendarId:string;timeMin:string;timeMax:string}>):void { if(input.calendarId.length<1||input.calendarId.length>1024||/[\u0000-\u001f\u007f]/u.test(input.calendarId))fail();const start=parseRfc3339(input.timeMin,true),end=parseRfc3339(input.timeMax,true);if(end<=start||end-start>31*86_400_000)fail(); }
async function safeFetch(fetcher:Fetcher,input:string|URL,init:RequestInit):Promise<Response>{try{return await fetcher(input,init);}catch(error){if(error instanceof AvailabilityCredentialInvalidError)throw error;fail();}}
async function payload(response:Response,refresh:boolean):Promise<Record<string,unknown>>{const length=response.headers.get("content-length");if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_RESPONSE_BYTES))fail();let value:unknown;try{value=await response.json();}catch{fail();}const result=record(value);if(!response.ok){if(refresh&&result.error==="invalid_grant")throw new AvailabilityCredentialInvalidError();fail();}return result;}
function parseRfc3339(value:string,utcOnly=false):number {const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);if(!match||(utcOnly&&match[8]!=="Z"))fail();const [,year,month,day,hour,minute,second,fraction="",zone,sign,offsetHour="00",offsetMinute="00"]=match;if(Number(offsetHour)>23||Number(offsetMinute)>59)fail();const milliseconds=Number(fraction.padEnd(3,"0"));const offset=(sign==="-"?-1:1)*(Number(offsetHour)*60+Number(offsetMinute));const instant=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second),milliseconds)-(zone==="Z"?0:offset*60_000);const wall=new Date(instant+(zone==="Z"?0:offset*60_000));if(!Number.isFinite(instant)||wall.getUTCFullYear()!==Number(year)||wall.getUTCMonth()+1!==Number(month)||wall.getUTCDate()!==Number(day)||wall.getUTCHours()!==Number(hour)||wall.getUTCMinutes()!==Number(minute)||wall.getUTCSeconds()!==Number(second)||wall.getUTCMilliseconds()!==milliseconds)fail();return instant;}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))fail();return value as Record<string,unknown>;}
function required(value:unknown):string{if(typeof value!=="string"||!value)fail();return value;}
function fail():never{throw new AvailabilityProviderUnavailableError();}
