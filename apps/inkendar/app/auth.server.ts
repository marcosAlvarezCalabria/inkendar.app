import { AccessDeniedError, type AccessRole, type AuthorizedAccess } from "@inkendar/domain";
import { createAuthenticationService, InvalidCredentialsError } from "@inkendar/application";
import { createSupabaseAuthRequestAdapter, privateHeaders } from "@inkendar/infrastructure";

export type AuthRequestContext = Readonly<{
  headers: Headers;
  service: ReturnType<typeof createAuthenticationService>;
}>;

export type AuthorizedRequestAccess = Readonly<{
  access: AuthorizedAccess;
  headers: Headers;
}>;

type ContextFactory = (request: Request) => AuthRequestContext;
type TrustedOriginFactory = (request: Request) => string | null;

const INTERNAL_URL_BASE = "https://inkendar.invalid";

export function createAuthRequestContext(request: Request): AuthRequestContext {
  const { adapter, headers } = createSupabaseAuthRequestAdapter(request, process.env);
  return {
    headers,
    service: createAuthenticationService({ memberships: adapter, session: adapter }),
  };
}

export function createAuthHandlers(
  createContext: ContextFactory = createAuthRequestContext,
  trustedOrigin: TrustedOriginFactory = defaultTrustedOrigin,
) {
  return {
    async login(request: Request): Promise<Response> {
      if (!isTrustedMutation(request, trustedOrigin(request))) return rejectedMutation();
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
      const access = await currentAccessOrDenied(context);
      return access
        ? redirectResponse(roleHome(access.role), context.headers)
        : Response.json({}, { headers: context.headers });
    },

    async current(request: Request): Promise<Response | AuthorizedAccess> {
      const context = createContext(request);
      const access = await currentAccessOrDenied(context);
      return access ? redirectResponse(roleHome(access.role), context.headers) : redirectResponse("/login", context.headers);
    },

    async requireRole(request: Request, requiredRole: AccessRole): Promise<Response | AuthorizedRequestAccess> {
      const context = createContext(request);
      const access = await currentAccessOrDenied(context);
      if (!access) {
        const url = new URL(request.url);
        const returnTo = `${url.pathname}${url.search}`;
        return redirectResponse(`/login?returnTo=${encodeURIComponent(returnTo)}`, context.headers);
      }
      if (access.role !== requiredRole) throw accessDenied(context.headers);
      return { access, headers: context.headers };
    },

    async logout(request: Request): Promise<Response> {
      if (!isTrustedMutation(request, trustedOrigin(request))) return rejectedMutation();
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
    const url = new URL(value, INTERNAL_URL_BASE);
    if (url.origin !== INTERNAL_URL_BASE) return fallback;
    const allowedPrefix = role === "OWNER" ? "/app/owner" : "/app/artist";
    if (url.pathname !== "/app" && url.pathname !== allowedPrefix && !url.pathname.startsWith(`${allowedPrefix}/`)) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function isTrustedMutationRequest(request: Request): boolean {
  return isTrustedMutation(request, defaultTrustedOrigin(request));
}

export const authHandlers = createAuthHandlers();

async function currentAccessOrDenied(context: AuthRequestContext): Promise<AuthorizedAccess | null> {
  try {
    return await context.service.currentAccess();
  } catch (error: unknown) {
    if (error instanceof AccessDeniedError) throw accessDenied(context.headers);
    throw error;
  }
}

function defaultTrustedOrigin(request: Request): string | null {
  const configured = process.env.INKENDAR_APP_ORIGIN;
  if (configured !== undefined) return normalizedOrigin(configured);
  if (process.env.NODE_ENV === "production") return null;
  return new URL(request.url).origin;
}

function isTrustedMutation(request: Request, trustedOrigin: string | null): boolean {
  if (!trustedOrigin) return false;
  const origin = request.headers.get("Origin");
  if (!origin || normalizedOrigin(origin) !== trustedOrigin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite === null || fetchSite === "same-origin";
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== value) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function rejectedMutation(): Response {
  return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
}

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
