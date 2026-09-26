import { createAccessSuspensionService, InvalidAccessChangeError } from "@inkendar/application";
import { AccessDeniedError } from "@inkendar/domain";
import { createSupabaseAccessSuspensionRepository, privateHeaders } from "@inkendar/infrastructure";

import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  service(request: Request, authorization: AuthorizedRequestAccess): ReturnType<typeof createAccessSuspensionService>;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  service: (_request, authorization) => {
    if (!authorization.sessionClient) throw new Error("Authenticated session client unavailable");
    return createAccessSuspensionService(createSupabaseAccessSuspensionRepository(authorization.sessionClient));
  },
};

export function createOwnerAccessHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = responseHeaders(authorization.headers);
      try {
        const members = await dependencies.service(request, authorization).listMembers(authorization.access);
        const result = new URL(request.url).searchParams.get("result");
        return Response.json({ members, result: result === "suspended" || result === "restored" ? result : null }, { headers });
      } catch {
        return publicError(500, headers);
      }
    },

    async action(request: Request): Promise<Response> {
      if (request.method !== "POST" || !isTrustedMutationRequest(request)) {
        return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
      }
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = responseHeaders(authorization.headers);
      try {
        const form = await request.formData();
        if (Array.from(form.keys()).length !== 2 || form.getAll("intent").length !== 1 || form.getAll("membershipId").length !== 1) {
          throw new InvalidAccessChangeError();
        }
        const intent = form.get("intent");
        const membershipId = form.get("membershipId");
        if ((intent !== "SUSPEND" && intent !== "RESTORE") || typeof membershipId !== "string") {
          throw new InvalidAccessChangeError();
        }
        await dependencies.service(request, authorization).setArtistStatus(
          authorization.access,
          membershipId,
          intent === "SUSPEND" ? "SUSPENDED" : "ACTIVE",
        );
        headers.set("Location", `/app/owner/team?result=${intent === "SUSPEND" ? "suspended" : "restored"}`);
        return new Response(null, { status: 303, headers });
      } catch (error) {
        if (error instanceof InvalidAccessChangeError) return publicError(400, headers);
        if (error instanceof AccessDeniedError) return publicError(403, headers);
        return publicError(500, headers);
      }
    },
  };
}

export const ownerAccessHandlers = createOwnerAccessHandlers();

function responseHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

function publicError(status: number, headers: Headers): Response {
  return Response.json(
    { error: status === 400 ? "Revisa los datos de la solicitud." : status === 403 ? "Acceso denegado." : "No se pudo completar la operación." },
    { status, headers },
  );
}
