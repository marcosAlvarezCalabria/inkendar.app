import {
  GoogleCalendarConnectionUnavailableError,
  GoogleCalendarNotAssignableError,
  GoogleOAuthAttemptInvalidError,
  GoogleOAuthGrantIncompleteError,
  InvalidGoogleCalendarInputError,
  createGoogleCalendarService,
} from "@inkendar/application";
import {
  AesGcmGoogleTokenProtector,
  GoogleCalendarHttpAdapter,
  NodeGoogleOAuthSecurity,
  createSupabaseGoogleCalendarRepository,
  loadGoogleCalendarConfig,
  loadGoogleTokenEncryptionKey,
} from "@inkendar/infrastructure";
import type { AuthorizedAccess } from "@inkendar/domain";
import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

export type OwnerGoogleCalendarService = Pick<ReturnType<typeof createGoogleCalendarService>,
  "beginConnection" | "completeConnection" | "cancelConnectionAttempt" | "getManagementView" | "assignCalendar" | "disconnect">;

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  createService(access: AuthorizedAccess): OwnerGoogleCalendarService;
  now(): Date;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  createService: (access) => compose(access, process.env),
  now: () => new Date(),
};

export function createOwnerGoogleCalendarHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      const view = await dependencies.createService(authorization.access).getManagementView(authorization.access.studioId);
      return Response.json(view, { headers });
    },

    async action(request: Request): Promise<Response> {
      if (request.method !== "POST") return methodNotAllowed();
      if (!isTrustedMutationRequest(request)) return rejected();
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const form = await request.formData();
        const intent = required(form, "intent");
        const service = dependencies.createService(authorization.access);
        if (intent === "connect") {
          const target = new URL(await service.beginConnection(authorization.access.studioId, authorization.access.userId, dependencies.now()));
          if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth") throw new InvalidGoogleCalendarInputError();
          headers.set("Location", target.toString());
          return new Response(null, { status: 302, headers });
        }
        if (intent === "disconnect") {
          await service.disconnect(authorization.access.studioId);
          return localRedirect("disconnected", headers);
        }
        if (intent === "assign") {
          const calendarId = optional(form, "calendarId");
          await service.assignCalendar(authorization.access.studioId, required(form, "artistProfileId"), calendarId?.trim() ? calendarId : null);
          return localRedirect("assignment-saved", headers);
        }
        throw new InvalidGoogleCalendarInputError();
      } catch (error) {
        return actionError(error, headers);
      }
    },

    async callback(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return callbackDenied(authorization.headers);
      const headers = privateHeaders(authorization.headers);
      const url = new URL(request.url);
      const states = url.searchParams.getAll("state");
      const codes = url.searchParams.getAll("code");
      const errors = url.searchParams.getAll("error");
      if (states.length !== 1 || codes.length > 1 || errors.length > 1 || (codes.length === 1) === (errors.length === 1)) {
        return localRedirect("invalid-state", headers);
      }
      const service = dependencies.createService(authorization.access);
      try {
        if (errors.length === 1) {
          await service.cancelConnectionAttempt(authorization.access.studioId, authorization.access.userId, states[0] ?? "", dependencies.now());
          return localRedirect("denied", headers);
        }
        await service.completeConnection(authorization.access.studioId, authorization.access.userId, states[0] ?? "", codes[0] ?? "", dependencies.now());
        return localRedirect("connected", headers);
      } catch (error) {
        if (error instanceof GoogleOAuthAttemptInvalidError || error instanceof InvalidGoogleCalendarInputError) return localRedirect("invalid-state", headers);
        if (error instanceof GoogleOAuthGrantIncompleteError) return localRedirect("reconnect-required", headers);
        return localRedirect("failed", headers);
      }
    },
  };
}

export const ownerGoogleCalendarHandlers = createOwnerGoogleCalendarHandlers();

function compose(access: AuthorizedAccess, environment: Record<string, string | undefined>): OwnerGoogleCalendarService {
  const config = loadGoogleCalendarConfig(environment);
  return createGoogleCalendarService({
    repository: createSupabaseGoogleCalendarRepository(environment, access.userId),
    provider: new GoogleCalendarHttpAdapter(config),
    security: new NodeGoogleOAuthSecurity(),
    tokens: new AesGcmGoogleTokenProtector(loadGoogleTokenEncryptionKey(environment)),
  });
}
function required(form: FormData, name: string): string {
  const value = form.get(name); if (typeof value !== "string") throw new InvalidGoogleCalendarInputError(); return value;
}
function optional(form: FormData, name: string): string | null {
  const value = form.get(name); if (value === null) return null; if (typeof value !== "string") throw new InvalidGoogleCalendarInputError(); return value;
}
function privateHeaders(source?: Headers): Headers { const headers = new Headers(source); headers.set("Cache-Control", "private, no-store"); return headers; }
function callbackDenied(source: Headers): Response {
  const headers = privateHeaders(source);
  headers.delete("Location");
  return new Response("Acceso denegado", { status: 403, headers });
}
function localRedirect(result: string, headers: Headers): Response {
  headers.set("Location", `/app/owner/calendars?result=${encodeURIComponent(result)}`); return new Response(null, { status: 303, headers });
}
function rejected(): Response { return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() }); }
function methodNotAllowed(): Response { const headers = privateHeaders(); headers.set("Allow", "POST"); return new Response("Solicitud no admitida", { status: 405, headers }); }
function actionError(error: unknown, headers: Headers): Response {
  if (error instanceof InvalidGoogleCalendarInputError) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers });
  if (error instanceof GoogleCalendarNotAssignableError || error instanceof GoogleCalendarConnectionUnavailableError) return Response.json({ error: "El calendario no se puede asignar." }, { status: 409, headers });
  return Response.json({ error: "No se pudo completar la operación." }, { status: 500, headers });
}
