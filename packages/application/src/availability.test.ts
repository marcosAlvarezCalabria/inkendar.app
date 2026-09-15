import { describe, expect, it, vi } from "vitest";
import { AvailabilitySetupRequiredError, GOOGLE_FREE_BUSY_SCOPE, createArtistAvailabilityService, type ArtistAvailabilityRepositoryPort, type GoogleFreeBusyPort } from "./availability.js";
const studioId="20000000-0000-4000-8000-000000000001", artistId="50000000-0000-4000-8000-000000000001";
const rules={timeZone:"Europe/Madrid",windows:[{weekday:1,start:"09:00",end:"11:00"}],slotIncrementMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0};
function deps(scopes:string[]=[GOOGLE_FREE_BUSY_SCOPE]) { const repository:ArtistAvailabilityRepositoryPort={getConfiguration:vi.fn(async()=>({artistProfileId:artistId,calendarId:"artist@test",rules,connection:{id:"81000000-0000-4000-8000-000000000001",studioId,status:"ACTIVE" as const,encryptedRefreshToken:"cipher",grantedScopes:scopes}})),saveRules:vi.fn(async()=>undefined),markReauthRequired:vi.fn(async()=>undefined)}; const provider:GoogleFreeBusyPort={queryBusy:vi.fn(async()=>[{startUtc:"2026-09-28T08:00:00Z",endUtc:"2026-09-28T08:30:00Z"}])}; return {repository,provider,tokens:{encrypt:vi.fn(),decrypt:vi.fn(()=>"secret")}}; }
describe("artist availability service",()=>{
 it("fails with reconnect before decrypting or calling FreeBusy when an old grant lacks scope",async()=>{const d=deps([]);await expect(createArtistAvailabilityService(d).preview(studioId,artistId,"2026-09-28T00:00:00Z","2026-09-29T00:00:00Z",30)).rejects.toEqual(new AvailabilitySetupRequiredError("RECONNECT"));expect(d.tokens.decrypt).not.toHaveBeenCalled();expect(d.provider.queryBusy).not.toHaveBeenCalled();});
 it("makes one bounded FreeBusy query and returns candidate slots",async()=>{const d=deps();const slots=await createArtistAvailabilityService(d).preview(studioId,artistId,"2026-09-28T00:00:00Z","2026-09-29T00:00:00Z",30);expect(d.provider.queryBusy).toHaveBeenCalledOnce();expect(d.provider.queryBusy).toHaveBeenCalledWith("secret",{calendarId:"artist@test",timeMin:"2026-09-28T00:00:00Z",timeMax:"2026-09-29T00:00:00Z"});expect(slots.map(x=>x.startLocal)).toEqual(["2026-09-28T09:00","2026-09-28T09:30","2026-09-28T10:30"]);});
});


