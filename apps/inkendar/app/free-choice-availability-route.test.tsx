import {renderToStaticMarkup} from "react-dom/server";
import {createStaticHandler,createStaticRouter,StaticRouterProvider} from "react-router";
import {describe,expect,it,vi} from "vitest";
const handler=vi.hoisted(()=>({loader:vi.fn(),action:vi.fn()}));
vi.mock("./free-choice-availability.server.js",()=>({publicFreeChoiceAvailabilityHandlers:handler,publicFreeChoiceAvailabilityHeaders:()=>new Headers({"Cache-Control":"private, no-store"})}));
import Page,{ErrorBoundary,loader} from "./routes/public-availability.js";
const routes=[{id:"availability",path:"availability/:token",loader:loader as never,Component:Page,ErrorBoundary}];
async function render(data:unknown){handler.loader.mockResolvedValueOnce(Response.json(data));const {query,dataRoutes}=createStaticHandler(routes),result=await query(new Request(`https://app.inkendar.es/availability/${"A".repeat(43)}`));if(result instanceof Response)throw new Error("Expected context");return renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(dataRoutes,result)} context={result}/>);}
describe("public free-choice route",()=>{
 it("offers opaque candidate selectors without PII or internal IDs",async()=>{const html=await render({state:"OPEN",rangeStart:"2026-09-21T00:00:00.000Z",rangeEnd:"2026-09-22T00:00:00.000Z",durationMinutes:60,expiresAt:"2026-09-21T12:00:00.000Z",artistDisplayName:"Ana",timeZone:"Europe/Dublin",slots:[{selector:"ab".repeat(32),startUtc:"2026-09-21T09:00:00.000Z",endUtc:"2026-09-21T10:00:00.000Z",startLocal:"2026-09-21T10:00",endLocal:"2026-09-21T11:00"}]});expect(html).toContain("Huecos disponibles");expect(html).toContain("Solicitar este hueco");expect(html).not.toMatch(/customer|caseId|studioId|calendarId/iu);});
 it("after selection renders only pending confirmation and chosen interval",async()=>{const html=await render({state:"PENDING_OWNER_APPROVAL",expiresAt:"2026-09-21T09:00:00.000Z",artistDisplayName:"Ana",timeZone:"Europe/Dublin",selectedSlot:{startUtc:"2026-09-21T09:00:00.000Z",endUtc:"2026-09-21T10:00:00.000Z",startLocal:"2026-09-21T10:00",endLocal:"2026-09-21T11:00"}});expect(html).toContain("pendiente de aprobación");expect(html).not.toMatch(/<form|Solicitar este hueco/iu);});
});
