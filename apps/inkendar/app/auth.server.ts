import { AccessDeniedError, type AccessRole, type AuthorizedAccess } from "@inkendar/domain";
import { createAuthenticationService, InvalidCredentialsError } from "@inkendar/application";
import { createSupabaseAuthRequestAdapter } from "@inkendar/infrastructure";

export type AuthRequestContext = Readonly<{
  headers: Headers;
  service: ReturnType<typeof createAuthenticationService>;
}>;

type ContextFactory = (request: Request) => AuthRequestContext;

export function createAuthRequestContext(request: Request): AuthRequestContext {
  const { adapter, headers } = createSupabaseAuthRequestAdapter(request, process.env);
  return {
    headers,
    service: createAuthenticationService({ memberships: adapter, session: adapter }),
  };
}

export function createAuthHandlers(createContext: ContextFactory = createAuthRequestContext) {
  return {
    async login(request: Request): Promise<Response> {
      const context = createContext(request);
      const form = await request.formData();
      const email = form.get("email");
      const password = form.get("password");
      if (typeof email !== "string" || typeof password !== "string") {
        return loginError(context.headers);
      }
      try {
        const access = await context.service.login({ email, password });
        const returnTo = new URL(request.url).searchParams.get("returnTo");
        return redirectResponse(safeReturnPath(returnTo, access.role), context.headers);
      } catch (error: unknown) {
        if (error instanceof AccessDeniedError) throw accessDenied(context.headers);
        if (error instanceof InvalidCredentialsError) return loginError(context.headers);
        return loginError(context.headers);
      }
    },

    async loginPage(request: Request): Promise<Response> {
      const context = createContext(request);
      try {
        const access = await context.service.currentAccess();
        return access
          ? redirectResponse(roleHome(access.role), context.headers)
          : Response.json({}, { headers: context.headers });
      } catch (error: unknown) {
        if (error instanceof AccessDeniedError) throw accessDenied(context.headers);
        throw error;
      }
    },

    async current(request: Request): Promise<Response | AuthorizedAccess> {
      const context = createContext(request);
      const access = await context.service.currentAccess();
      return access ? redirectResponse(roleHome(access.role), context.headers) : redirectResponse("/login", context.headers);
    },

    async requireRole(request: Request, requiredRole: AccessRole): Promise<Response | AuthorizedAccess> {
      const context = createContext(request);
      let access: AuthorizedAccess | null;
      try {
        access = await context.service.currentAccess();
      } catch (error: unknown) {
        if (error instanceof AccessDeniedError) throw accessDenied(context.headers);
        throw error;
      }
      if (!access) {
        const url = new URL(request.url);
        const returnTo = `${url.pathname}${url.search}`;
        return redirectResponse(`/login?returnTo=${encodeURIComponent(returnTo)}`, context.headers);
      }
      if (access.role !== requiredRole) throw accessDenied(context.headers);
      return access;
    },

    async logout(request: Request): Promise<Response> {
      const context = createContext(request);
      await context.service.logout();
      return redirectResponse("/login", context.headers);
    },
  };
}

export function safeReturnPath(value: string | null, role: AccessRole): string {
  const fallback = roleHome(role);
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "https://app.inkendar.es");
    if (url.origin !== "https://app.inkendar.es") return fallback;
    const allowedPrefix = role === "OWNER" ? "/app/owner" : "/app/artist";
    if (url.pathname !== "/app" && url.pathname !== allowedPrefix && !url.pathname.startsWith(`${allowedPrefix}/`)) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export const authHandlers = createAuthHandlers();

function roleHome(role: AccessRole): string {
  return role === "OWNER" ? "/app/owner" : "/app/artist";
}

function redirectResponse(location: string, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Location", location);
  return new Response(null, { status: 302, headers: responseHeaders });
}

function loginError(headers: Headers): Response {
  return Response.json(
    { error: "No se pudo iniciar sesión con esas credenciales." },
    { status: 400, headers },
  );
}

function accessDenied(headers: Headers): Response {
  return new Response("Acceso denegado", { status: 403, headers });
}
