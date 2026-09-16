import { describe, expect, it, vi } from "vitest";

import { createArtistAgendaService, type ArtistAgendaRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";

import { createArtistAgendaHandlers, type ArtistAuthorization } from "./artist-agenda.server.js";

const artist: AuthorizedAccess = {
  displayName: "Artista",
  role: "ARTIST",
  studioId: "20000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
};

function repository(): ArtistAgendaRepositoryPort {
  return { listUpcoming: vi.fn(async () => []) };
}

function subject(
  repo = repository(),
  authorize: () => Promise<ArtistAuthorization> = async () => ({
    access: artist,
    headers: new Headers({ "Set-Cookie": "session=rotated" }),
  }),
) {
  return {
    repo,
    handlers: createArtistAgendaHandlers({
      authorize,
      service: () => createArtistAgendaService({ repository: repo, clock: () => new Date("2026-09-20T10:00:00.000Z") }),
    }),
  };
}

describe("artist agenda handler", () => {
  it("returns a private minimal agenda after the ARTIST guard", async () => {
    const repo = repository();
    vi.mocked(repo.listUpcoming).mockResolvedValueOnce([{
      startUtc: "2026-09-20T10:00:00.000Z",
      endUtc: "2026-09-20T11:00:00.000Z",
      customerDisplayName: "Cliente sintético",
      caseSummary: "Pieza floral",
      bodyArea: null,
      size: null,
      timeZone: "UTC",
    }]);
    const { handlers } = subject(repo);

    const response = await handlers.loader(new Request("https://app.inkendar.es/app/artist"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
    const body = await response.json();
    expect(body).toEqual({ displayName: "Artista", appointments: [expect.objectContaining({ caseSummary: "Pieza floral" })] });
    expect(JSON.stringify(body)).not.toMatch(/studioId|userId|appointmentId|customerId|conversation|google|token|email|phone/iu);
  });

  it("denies OWNER before composing or querying the agenda", async () => {
    const denied = new Response("Acceso denegado", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    const createService = vi.fn();
    const handlers = createArtistAgendaHandlers({ authorize: async () => denied, service: createService });

    const response = await handlers.loader(new Request("https://app.inkendar.es/app/artist"));

    expect(response.status).toBe(403);
    expect(createService).not.toHaveBeenCalled();
  });

  it("returns a generic private error without leaking repository details", async () => {
    const repo = repository();
    vi.mocked(repo.listUpcoming).mockRejectedValueOnce(new Error("customer private@example.test in tenant 123"));
    const { handlers } = subject(repo);

    const response = await handlers.loader(new Request("https://app.inkendar.es/app/artist"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "No se pudo cargar la agenda." });
  });
});
