import { BookingContextNotFoundError, BookingHoldConflictError, InvalidBookingOfferInputError, createBookingOfferService } from "@inkendar/application";
import { createSupabaseBookingOfferRepository } from "@inkendar/infrastructure";
import type { AuthorizedAccess } from "@inkendar/domain";
import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

type Service = ReturnType<typeof createBookingOfferService>;
type Dependencies = Readonly<{ authorize(request: Request): Promise<Response | AuthorizedRequestAccess>; createService(access: AuthorizedAccess): Service }>;
const defaults: Dependencies = { authorize: (request) => authHandlers.requireRole(request, "OWNER"), createService: (access) => createBookingOfferService({ repository: createSupabaseBookingOfferRepository(process.env, access.userId) }) };

export function createOwnerBookingOfferHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      try { return Response.json(await dependencies.createService(authorization.access).list(authorization.access.studioId), { headers: headers(authorization.headers) }); }
      catch { return Response.json({ error: "No se pudieron cargar las ofertas." }, { status: 500, headers: headers(authorization.headers) }); }
    },
    async action(request: Request): Promise<Response> {
      if (request.method !== "POST" || !isTrustedMutationRequest(request)) return new Response("Solicitud rechazada", { status: 403, headers: headers() });
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const responseHeaders = headers(authorization.headers);
      try {
        const form = await request.formData(), intent = required(form, "intent"), service = dependencies.createService(authorization.access);
        if (intent === "configure-expiry") await service.configureExpiry(authorization.access.studioId, integer(form, "expiryHours"));
        else if (intent === "create") await service.create(authorization.access.studioId, required(form, "tattooCaseId"), required(form, "artistProfileId"), options(required(form, "options")));
        else if (intent === "expire-due") await service.expireDue(authorization.access.studioId);
        else throw new InvalidBookingOfferInputError();
        responseHeaders.set("Location", "/app/owner/offers");
        return new Response(null, { status: 303, headers: responseHeaders });
      } catch (error) {
        if (error instanceof InvalidBookingOfferInputError) return Response.json({ error: "Revisa los datos de la oferta." }, { status: 400, headers: responseHeaders });
        if (error instanceof BookingContextNotFoundError) return Response.json({ error: "El caso o artista no está disponible." }, { status: 404, headers: responseHeaders });
        if (error instanceof BookingHoldConflictError) return Response.json({ error: "Una opción ya está bloqueada." }, { status: 409, headers: responseHeaders });
        return Response.json({ error: "No se pudo completar la operación." }, { status: 500, headers: responseHeaders });
      }
    },
  };
}
export const ownerBookingOfferHandlers = createOwnerBookingOfferHandlers();
function headers(source?: Headers): Headers { const result = new Headers(source); result.set("Cache-Control", "private, no-store"); return result; }
function required(form: FormData, name: string): string { const value = form.get(name); if (typeof value !== "string" || value.length > 4096) throw new InvalidBookingOfferInputError(); return value.trim(); }
function integer(form: FormData, name: string): number { const value = Number(required(form, name)); if (!Number.isInteger(value)) throw new InvalidBookingOfferInputError(); return value; }
function options(value: string) { return value.split(/\r?\n/u).filter((line) => line.trim()).map((line) => { const parts = line.split(",").map((item) => item.trim()); if (parts.length !== 2) throw new InvalidBookingOfferInputError(); return { startUtc: utc(parts[0]!), endUtc: utc(parts[1]!) }; }); }
function utc(value: string): string { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) throw new InvalidBookingOfferInputError(); const date = new Date(`${value}:00.000Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value) throw new InvalidBookingOfferInputError(); return date.toISOString(); }
