import {
  PublicBookingOfferSelectionRejectedError,
  PublicBookingOfferUnavailableError,
  createBookingOfferAccessService,
} from "@inkendar/application";
import { normalizePublicBookingOfferToken, normalizePublicBookingOptionSelector } from "@inkendar/domain";
import {
  createSupabaseBookingOfferAccessRepository,
  createSupabasePublicBookingOfferRepository,
  secureBookingOfferTokenBytes,
  sha256BookingOfferToken,
} from "@inkendar/infrastructure";
import { isTrustedMutationRequest } from "./auth.server.js";

type Service = ReturnType<typeof createBookingOfferAccessService>;
type Dependencies = Readonly<{ createService(): Service }>;

const defaults: Dependencies = {
  createService: () => createBookingOfferAccessService({
    ownerRepository: createSupabaseBookingOfferAccessRepository(process.env, "00000000-0000-4000-8000-000000000000"),
    publicRepository: createSupabasePublicBookingOfferRepository(process.env),
    randomBytes: secureBookingOfferTokenBytes,
    hashToken: sha256BookingOfferToken,
  }),
};

export function createPublicBookingOfferHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(_request: Request, rawToken: string | undefined): Promise<Response> {
      if (!isCanonicalToken(rawToken)) return unavailable();
      try {
        const result = await dependencies.createService().getPublic(rawToken);
        return Response.json(result, { headers: publicBookingOfferHeaders() });
      } catch {
        return unavailable();
      }
    },

    async action(request: Request, rawToken: string | undefined): Promise<Response> {
      if (request.method !== "POST" || !isTrustedMutationRequest(request)) return rejected(403, "Solicitud rechazada.");
      if (!isCanonicalToken(rawToken)) return unavailable();
      let selector: string;
      try { selector = await readSelector(request); }
      catch { return rejected(400, "No se pudo registrar la selección."); }
      try {
        const result = await dependencies.createService().selectPublic(rawToken, selector);
        return Response.json(result, { headers: publicBookingOfferHeaders() });
      } catch (error) {
        if (error instanceof PublicBookingOfferUnavailableError) return unavailable();
        if (error instanceof PublicBookingOfferSelectionRejectedError) return rejected(409, "No se pudo registrar la selección.");
        return rejected(500, "No se pudo registrar la selección.");
      }
    },
  };
}

export const publicBookingOfferHandlers = createPublicBookingOfferHandlers();

export function publicBookingOfferHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  });
}

function isCanonicalToken(token: string | undefined): token is string {
  if (token === undefined) return false;
  try { normalizePublicBookingOfferToken(token); return true; }
  catch { return false; }
}

function unavailable(): Response {
  return new Response("Esta oferta no está disponible.", { status: 404, headers: publicBookingOfferHeaders() });
}

const PUBLIC_SELECTION_BODY_LIMIT = 256;

async function readSelector(request: Request): Promise<string> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new Error("Invalid public selection request");
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > PUBLIC_SELECTION_BODY_LIMIT)) throw new Error("Invalid public selection request");
  const body = await readBoundedBody(request, PUBLIC_SELECTION_BODY_LIMIT);
  const parameters = new URLSearchParams(body);
  const entries = Array.from(parameters.entries());
  if (entries.length !== 1 || entries[0]?.[0] !== "selector") throw new Error("Invalid public selection request");
  return normalizePublicBookingOptionSelector(entries[0][1]);
}

async function readBoundedBody(request: Request, limit: number): Promise<string> {
  if (!request.body) throw new Error("Invalid public selection request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Invalid public selection request");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function rejected(status: number, message: string): Response {
  return new Response(message, { status, headers: publicBookingOfferHeaders() });
}
