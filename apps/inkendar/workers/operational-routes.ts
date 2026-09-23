type ReadinessEnvironment = Readonly<{
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  INKENDAR_APP_ORIGIN?: string;
  IMAGES?: unknown;
}>;

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" } as const;

export function operationalResponse(request: Request, environment: ReadinessEnvironment): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname === "/healthz") return Response.json({ status: "ok" }, { headers: HEADERS });
  if (pathname !== "/readyz") return null;
  const ready = present(environment.SUPABASE_URL)
    && present(environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY)
    && present(environment.SUPABASE_SERVICE_ROLE_KEY)
    && present(environment.INKENDAR_APP_ORIGIN)
    && environment.IMAGES !== undefined;
  return Response.json({ status: ready ? "ready" : "not-ready" }, { status: ready ? 200 : 503, headers: HEADERS });
}

function present(value: string | undefined): boolean { return typeof value === "string" && value.trim().length > 0; }
