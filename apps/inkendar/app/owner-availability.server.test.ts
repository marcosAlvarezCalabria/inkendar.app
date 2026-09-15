import { describe,expect,it,vi } from "vitest";
import { createOwnerAvailabilityHandlers } from "./owner-availability.server.js";
describe("owner availability handlers",()=>{
 it("fails closed before composing availability for ARTIST/anonymous",async()=>{const createService=vi.fn();const handlers=createOwnerAvailabilityHandlers({authorize:async()=>new Response("Denied",{status:403}),createService});expect((await handlers.loader(new Request("https://app.inkendar.es/app/owner/calendars?artistProfileId=x"))).status).toBe(403);expect(createService).not.toHaveBeenCalled();});
 it("rejects cross-origin preview before authorization",async()=>{const authorize=vi.fn(),createService=vi.fn();const handlers=createOwnerAvailabilityHandlers({authorize,createService});const form=new FormData();form.set("intent","preview-availability");expect((await handlers.action(new Request("https://app.inkendar.es/app/owner/calendars",{method:"POST",headers:{Origin:"https://evil.test"},body:form}))).status).toBe(403);expect(authorize).not.toHaveBeenCalled();});
});

