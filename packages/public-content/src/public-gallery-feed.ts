import type { StudioGallery } from "@inkendar/application";

export type PublicGalleryReader = Readonly<{ get(studioSlug: string): Promise<StudioGallery> }>;
export type RateLimitDecision = Readonly<{ allowed: boolean; limit: number; remaining: number; resetSeconds: number }>;
export type PublicGalleryRateLimiter = Readonly<{ consume(key: string): RateLimitDecision }>;

type FixedWindowOptions = Readonly<{
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}>;

type Counter = { count: number; resetAt: number };

export function createFixedWindowRateLimiter(options: FixedWindowOptions): PublicGalleryRateLimiter {
  if (!Number.isInteger(options.limit) || options.limit < 1 || !Number.isInteger(options.windowMs) || options.windowMs < 1) throw new Error("Invalid rate limit configuration");
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 1_024;
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("Invalid rate limit configuration");
  const counters = new Map<string, Counter>();

  return {
    consume(rawKey: string): RateLimitDecision {
      const currentTime = now();
      const key = rawKey.slice(0, 128);
      let counter = counters.get(key);
      if (counter === undefined || currentTime >= counter.resetAt) {
        if (counter === undefined && counters.size >= maxKeys) {
          for (const [candidate, value] of counters) if (currentTime >= value.resetAt) counters.delete(candidate);
          while (counters.size >= maxKeys) {
            const oldest = counters.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            counters.delete(oldest);
          }
        }
        counter = { count: 0, resetAt: currentTime + options.windowMs };
        counters.set(key, counter);
      }
      const resetSeconds = Math.max(1, Math.ceil((counter.resetAt - currentTime) / 1_000));
      if (counter.count >= options.limit) return { allowed: false, limit: options.limit, remaining: 0, resetSeconds };
      counter.count += 1;
      return { allowed: true, limit: options.limit, remaining: options.limit - counter.count, resetSeconds };
    },
  };
}

export function createPublicGalleryFeedHandler(reader: PublicGalleryReader, limiter: PublicGalleryRateLimiter) {
  return async (request: Request, studioSlug: string | undefined): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
    const limit = limiter.consume(studioSlug ?? "invalid");
    if (!limit.allowed) return textResponse("Demasiadas solicitudes.", 429, limit, { "Retry-After": String(limit.resetSeconds) });
    try {
      const gallery = await reader.get(studioSlug ?? "");
      const body = JSON.stringify(gallery);
      const etag = await createEtag(body);
      const headers = publicHeaders(limit);
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("ETag", etag);
      if (etagMatches(request.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      if (code === "PUBLIC_GALLERY_UNAVAILABLE") return textResponse("Galería no disponible.", 404, limit);
      return textResponse("Galería no disponible temporalmente.", 503, limit);
    }
  };
}

async function createEtag(body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const value = btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  return `"sha256-${value}"`;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const target = etag.replace(/^W\//u, "");
  return header.split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || candidate.replace(/^W\//u, "") === target;
  });
}

function publicHeaders(limit?: RateLimitDecision): Headers {
  const headers = new Headers({
    "Cache-Control": "public, max-age=60, s-maxage=60, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  if (limit) {
    headers.set("RateLimit-Limit", String(limit.limit));
    headers.set("RateLimit-Remaining", String(limit.remaining));
    headers.set("RateLimit-Reset", String(limit.resetSeconds));
  }
  return headers;
}

function textResponse(body: string, status: number, limit?: RateLimitDecision, extra?: Record<string, string>): Response {
  const headers = publicHeaders(limit);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  return new Response(body, { status, headers });
}

function methodNotAllowed(): Response {
  return textResponse("Método no permitido.", 405, undefined, { Allow: "GET, HEAD" });
}
