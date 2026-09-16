import { describe, expect, it, vi } from "vitest";

import {
  ARTIST_AGENDA_LIMIT,
  createArtistAgendaService,
  type ArtistAgendaRepositoryPort,
} from "./artist-agenda.js";

const item = {
  startUtc: "2026-09-20T09:00:00.000Z",
  endUtc: "2026-09-20T10:00:00.000Z",
  customerDisplayName: "Cliente sintético",
  caseSummary: "Pieza floral",
  bodyArea: "Brazo",
  size: "Mediana",
  timeZone: "Europe/Dublin",
} as const;

describe("artist agenda service", () => {
  it("uses the injected clock and fixed bound for upcoming appointments", async () => {
    const listUpcoming = vi.fn(async () => [item]);
    const repository: ArtistAgendaRepositoryPort = { listUpcoming };
    const service = createArtistAgendaService({
      repository,
      clock: () => new Date("2026-09-20T10:00:00.000Z"),
    });

    await expect(service.listUpcoming()).resolves.toEqual([item]);
    expect(listUpcoming).toHaveBeenCalledWith({
      nowUtc: "2026-09-20T10:00:00.000Z",
      limit: ARTIST_AGENDA_LIMIT,
    });
  });

  it("fails closed for an invalid server clock", async () => {
    const listUpcoming = vi.fn();
    const service = createArtistAgendaService({
      repository: { listUpcoming },
      clock: () => new Date(Number.NaN),
    });

    await expect(service.listUpcoming()).rejects.toThrow("Server clock is invalid");
    expect(listUpcoming).not.toHaveBeenCalled();
  });
});
