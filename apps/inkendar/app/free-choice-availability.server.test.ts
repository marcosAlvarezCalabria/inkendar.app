import {describe,expect,it,vi} from "vitest";
import {createOwnerFreeChoiceAvailabilityHandlers,createPublicFreeChoiceAvailabilityHandlers} from "./free-choice-availability.server.js";
const access={displayName:"Owner",role:"OWNER" as const,studioId:"20000000-0000-4000-8000-000000000001",userId:"10000000-0000-4000-8000-000000000001"},artistId="50000000-0000-4000-8000-000000000001",caseId="60000000-0000-4000-8000-000000000001",token="A".repeat(43),selector="ab".repeat(32);
const service=()=>({management:vi.fn(async()=>({cases:[],pendingRequests:[]})),issue:vi.fn(async()=>({token,expiresAt:"2026-09-21T12:00:00.000Z"})),getPublic:vi.fn(),selectPublic:vi.fn(async()=>({state:"PENDING_OWNER_APPROVAL"}))});
describe("free-choice HTTP boundaries",()=>{
 it("issues only for an explicit case under OWNER same-origin",async()=>{const subject=service(),response=await createOwnerFreeChoiceAvailabilityHandlers({authorize:async()=>({access,headers:new Headers()}),createService:()=>subject as never}).action(new Request("https://app.inkendar.es/app/owner/calendars?freeChoice=1",{method:"POST",headers:{Origin:"https://app.inkendar.es","Sec-Fetch-Site":"same-origin"},body:new URLSearchParams({tattooCaseId:caseId,artistProfileId:artistId,rangeStart:"2026-09-21T00:00",rangeEnd:"2026-09-22T00:00",durationMinutes:"60",expiresAt:"2026-09-21T12:00"})}));expect(response.status).toBe(200);expect(subject.issue).toHaveBeenCalledWith(access.studioId,caseId,artistId,expect.any(Object));});
 it("denies anonymous and cross-origin before composition",async()=>{const createService=vi.fn(),handlers=createOwnerFreeChoiceAvailabilityHandlers({authorize:async()=>new Response("Denied",{status:403}),createService});expect((await handlers.action(new Request("https://app.inkendar.es/app/owner/calendars",{method:"POST",headers:{Origin:"https://app.inkendar.es","Sec-Fetch-Site":"same-origin"}}))).status).toBe(403);expect(createService).not.toHaveBeenCalled();});
 it("does not widen OWNER mutations to the opaque public provenance",async()=>{const authorize=vi.fn(),createService=vi.fn(),handlers=createOwnerFreeChoiceAvailabilityHandlers({authorize,createService});const response=await handlers.action(new Request("https://app.inkendar.es/app/owner/calendars",{method:"POST",headers:{Origin:"null","Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"navigate"}}));expect(response.status).toBe(403);expect(authorize).not.toHaveBeenCalled();expect(createService).not.toHaveBeenCalled();});
 it.each([
  ["the canonical HTTP origin",{Origin:"https://app.inkendar.es","Sec-Fetch-Site":"same-origin"}],
  ["the browser's opaque document origin",{Origin:"null","Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"navigate"}],
 ])("accepts a bounded selector-only POST from %s and redirects to the canonical view",async(_case,provenance)=>{const subject=service(),response=await createPublicFreeChoiceAvailabilityHandlers({createService:()=>subject as never}).action(new Request(`https://app.inkendar.es/availability/${token}/select`,{method:"POST",headers:{...provenance,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({selector})}),token);expect(response.status).toBe(303);expect(response.headers.get("Location")).toBe(`/availability/${token}`);expect(subject.selectPublic).toHaveBeenCalledWith(token,selector);expect(response.headers.get("Cache-Control")).toBe("private, no-store");});
 it.each([
  ["opaque cross-site navigation",{Origin:"null","Sec-Fetch-Site":"cross-site","Sec-Fetch-Mode":"navigate"}],
  ["opaque none-site navigation",{Origin:"null","Sec-Fetch-Site":"none","Sec-Fetch-Mode":"navigate"}],
  ["opaque same-origin CORS",{Origin:"null","Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors"}],
  ["opaque same-origin request without a mode",{Origin:"null","Sec-Fetch-Site":"same-origin"}],
  ["incorrect standard origin",{Origin:"https://evil.test","Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"navigate"}],
 ])("rejects %s before composing the public service",async(_case,provenance)=>{const createService=vi.fn(()=>service() as never),response=await createPublicFreeChoiceAvailabilityHandlers({createService}).action(new Request(`https://app.inkendar.es/availability/${token}/select`,{method:"POST",headers:{...provenance,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({selector})}),token);expect(response.status).toBe(404);expect(createService).not.toHaveBeenCalled();});
 it.each([
  ["extra fields",token,new URLSearchParams({selector,caseId}),"application/x-www-form-urlencoded"],
  ["duplicate selectors",token,new URLSearchParams([["selector",selector],["selector",selector]]),"application/x-www-form-urlencoded"],
  ["a malformed selector",token,new URLSearchParams({selector:"not-opaque"}),"application/x-www-form-urlencoded"],
  ["a malformed token","invalid",new URLSearchParams({selector}),"application/x-www-form-urlencoded"],
  ["the wrong content type",token,new URLSearchParams({selector}),"text/plain"],
  ["an oversized body",token,new URLSearchParams({selector:"a".repeat(257)}),"application/x-www-form-urlencoded"],
 ])("rejects %s generically",async(_case,rawToken,body,contentType)=>{const subject=service(),response=await createPublicFreeChoiceAvailabilityHandlers({createService:()=>subject as never}).action(new Request(`https://app.inkendar.es/availability/${rawToken}/select`,{method:"POST",headers:{Origin:"null","Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"navigate","Content-Type":contentType},body}),rawToken);expect(response.status).toBe(404);expect(subject.selectPublic).not.toHaveBeenCalled();});
});
