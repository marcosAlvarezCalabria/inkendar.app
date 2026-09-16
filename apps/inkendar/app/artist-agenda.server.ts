import { createArtistAgendaService } from "@inkendar/application";
import { createSupabaseArtistAgendaRequestRepository } from "@inkendar/infrastructure";

import { authHandlers, type AuthorizedRequestAccess } from "./auth.server.js";

export type ArtistAuthorization = Response | AuthorizedRequestAccess;

type Dependencies = Readonly<{
  authorize(request: Request): Promise<ArtistAuthorization>;
  service(request: Request): ReturnType<typeof createArtistAgendaService>;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "ARTIST"),
  service: (request) => createArtistAgendaService({
    repository: createSupabaseArtistAgendaRequestRepository(request, process.env),
  }),
};

export function createArtistAgendaHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request);
      if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const appointments = await dependencies.service(request).listUpcoming();
        return Response.json({ displayName: authorization.access.displayName, appointments }, { headers });
      } catch {
        return Response.json({ error: "No se pudo cargar la agenda." }, { status: 500, headers });
      }
    },
  };
}

export const artistAgendaHandlers = createArtistAgendaHandlers();

function privateHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}
