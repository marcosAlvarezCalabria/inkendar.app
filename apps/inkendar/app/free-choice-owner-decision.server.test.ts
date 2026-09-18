import {describe,expect,it,vi} from "vitest";
import {BookingConfirmationConflictError,BookingConfirmationMismatchError,BookingConfirmationProviderUnavailableError,BookingConfirmationReconnectRequiredError} from "@inkendar/application";
import {createOwnerFreeChoiceDecisionHandlers} from "./free-choice-owner-decision.server.js";
const studioId="20000000-0000-4000-8000-000000000001",userId="10000000-0000-4000-8000-000000000001",requestId="93000000-0000-4000-8000-000000000001";
const authorize=async()=>({access:{studioId,userId,role:"OWNER" as const,displayName:"Owner"},headers:new Headers()});
function request(intent:string,id=requestId){const form=new FormData();form.set("intent",intent);form.set("requestId",id);return new Request("https://app.inkendar.es/app/owner/calendars?freeChoice=1",{method:"POST",headers:{Origin:"https://app.inkendar.es","Sec-Fetch-Site":"same-origin"},body:form});}
describe("free-choice OWNER decision handler",()=>{
 it.each(["approve","reject"])("binds %s to the authenticated OWNER context",async(intent)=>{const service={approve:vi.fn(async()=>({state:"CONFIRMED" as const,confirmedAt:new Date().toISOString()})),reject:vi.fn(async()=>({state:"REJECTED" as const}))};const response=await createOwnerFreeChoiceDecisionHandlers({authorize,createService:()=>service}).action(request(intent));expect(response.status).toBe(303);expect(service[intent as keyof typeof service]).toHaveBeenCalledWith({studioId,ownerUserId:userId,requestId});});
 it("rejects untrusted mutations before authorization",async()=>{const auth=vi.fn(authorize);const response=await createOwnerFreeChoiceDecisionHandlers({authorize:auth,createService:vi.fn()}).action(new Request("https://app.inkendar.es/app/owner/calendars",{method:"POST"}));expect(response.status).toBe(403);expect(auth).not.toHaveBeenCalled();}); it.each([
  [new BookingConfirmationConflictError(),409,"El hueco ya no está disponible."],
  [new BookingConfirmationReconnectRequiredError(),409,"Vuelve a conectar Google Calendar antes de aprobar."],
  [new BookingConfirmationMismatchError(),409,"La solicitud requiere revisión manual."],
  [new BookingConfirmationProviderUnavailableError(),503,"Google Calendar no está disponible; reintenta con seguridad."],
 ])("maps approval failures to safe retry guidance",async(error,status,message)=>{const service={approve:vi.fn(async()=>{throw error;}),reject:vi.fn(async()=>({state:"REJECTED" as const}))};const response=await createOwnerFreeChoiceDecisionHandlers({authorize,createService:()=>service}).action(request("approve"));expect(response.status).toBe(status);expect(await response.json()).toEqual({error:message});expect(response.headers.get("Cache-Control")).toBe("private, no-store");});
});
