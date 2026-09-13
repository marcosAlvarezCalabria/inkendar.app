import {
  ArtistNotFoundError,
  CustomerNotFoundError,
  DuplicateCustomerError,
  InvalidCustomerCaseInputError,
  TattooCaseNotFoundError,
  createCustomerCasesService,
} from "@inkendar/application";
import { createSupabaseCustomerCasesRequestAdapter } from "@inkendar/infrastructure";

import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

export type OwnerAuthorization = Response | AuthorizedRequestAccess;

type Dependencies = Readonly<{
  authorize(request: Request): Promise<OwnerAuthorization>;
  service(request: Request): ReturnType<typeof createCustomerCasesService>;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  service: (request) => createCustomerCasesService(createSupabaseCustomerCasesRequestAdapter(request, process.env)),
};

export function createOwnerCustomerCasesHandlers(dependencies: Dependencies = defaults) {
  return {
    async customersLoader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const customers = await dependencies.service(request).listCustomers(authorization.access.studioId);
      return Response.json({ customers }, { headers: responseHeaders(authorization.headers) });
    },

    async casesLoader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const service = dependencies.service(request);
      const [cases, customers, artists] = await Promise.all([
        service.listTattooCases(authorization.access.studioId),
        service.listCustomers(authorization.access.studioId),
        service.listArtists(authorization.access.studioId),
      ]);
      return Response.json({ cases, customers, artists }, { headers: responseHeaders(authorization.headers) });
    },

    async customerAction(request: Request): Promise<Response> {
      if (!isTrustedMutationRequest(request)) return rejectedMutation();
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = responseHeaders(authorization.headers);
      try {
        const form = await request.formData();
        const intent = required(form, "intent");
        const service = dependencies.service(request);
        if (intent === "create") {
          await service.createCustomer(authorization.access.studioId, {
            name: required(form, "name"), email: optional(form, "email"), phone: optional(form, "phone"),
          });
        } else if (intent === "update") {
          await service.updateCustomer(authorization.access.studioId, required(form, "id"), {
            name: required(form, "name"), email: optional(form, "email"), phone: optional(form, "phone"), status: required(form, "status"),
          });
        } else {
          throw new InvalidCustomerCaseInputError("status");
        }
        return redirect("/app/owner/customers", headers);
      } catch (error: unknown) {
        return publicError(error, headers);
      }
    },

    async caseAction(request: Request): Promise<Response> {
      if (!isTrustedMutationRequest(request)) return rejectedMutation();
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = responseHeaders(authorization.headers);
      try {
        const form = await request.formData();
        const intent = required(form, "intent");
        const common = {
          summary: required(form, "summary"), bodyArea: optional(form, "bodyArea"), size: optional(form, "size"), artistProfileId: optional(form, "artistProfileId"),
        };
        const service = dependencies.service(request);
        if (intent === "create") {
          await service.createTattooCase(authorization.access.studioId, { ...common, customerId: required(form, "customerId") });
        } else if (intent === "update") {
          await service.updateTattooCase(authorization.access.studioId, required(form, "id"), { ...common, status: required(form, "status") });
        } else {
          throw new InvalidCustomerCaseInputError("status");
        }
        return redirect("/app/owner/cases", headers);
      } catch (error: unknown) {
        return publicError(error, headers);
      }
    },
  };
}

export const ownerCustomerCasesHandlers = createOwnerCustomerCasesHandlers();

function required(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new InvalidCustomerCaseInputError("status");
  return value;
}

function optional(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value !== "string") throw new InvalidCustomerCaseInputError("status");
  return value;
}

function responseHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

function redirect(location: string, headers: Headers): Response {
  headers.set("Location", location);
  return new Response(null, { status: 303, headers });
}

function rejectedMutation(): Response {
  return new Response("Solicitud rechazada", { status: 403, headers: responseHeaders() });
}

function publicError(error: unknown, headers: Headers): Response {
  if (error instanceof InvalidCustomerCaseInputError) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers });
  if (error instanceof DuplicateCustomerError) return Response.json({ error: "Ya existe un cliente con ese contacto." }, { status: 409, headers });
  if (error instanceof CustomerNotFoundError || error instanceof TattooCaseNotFoundError || error instanceof ArtistNotFoundError) {
    return Response.json({ error: "No se encontró el recurso solicitado." }, { status: 404, headers });
  }
  return Response.json({ error: "No se pudo completar la operación." }, { status: 500, headers });
}
