import {describe,expect,it,vi} from "vitest";

const handler=vi.hoisted(()=>({action:vi.fn()}));
vi.mock("./free-choice-availability.server.js",()=>({publicFreeChoiceAvailabilityHandlers:handler}));
import {action} from "./routes/public-availability-selection.js";

describe("public availability selection resource route",()=>{
 it("delegates a document POST and token to the public selection boundary",async()=>{const request=new Request(`https://app.inkendar.es/availability/${"A".repeat(43)}/select`,{method:"POST"}),expected=new Response(null,{status:303});handler.action.mockResolvedValueOnce(expected);await expect(action({request,params:{token:"A".repeat(43)},context:undefined} as never)).resolves.toBe(expected);expect(handler.action).toHaveBeenCalledWith(request,"A".repeat(43));});
});
