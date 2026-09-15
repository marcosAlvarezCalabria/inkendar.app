import { createBookingOfferAccessService } from "@inkendar/application";
import { normalizePublicBookingOfferToken } from "@inkendar/domain";
import {
  createSupabaseBookingOfferAccessRepository,
  createSupabasePublicBookingOfferRepository,
  secureBookingOfferTokenBytes,
  sha256BookingOfferToken,
} from "@inkendar/infrastructure";

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
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
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
