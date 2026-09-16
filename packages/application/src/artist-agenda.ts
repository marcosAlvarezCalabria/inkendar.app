export const ARTIST_AGENDA_LIMIT = 50;

export type ArtistAgendaItem = Readonly<{
  startUtc: string;
  endUtc: string;
  customerDisplayName: string;
  caseSummary: string;
  bodyArea: string | null;
  size: string | null;
  timeZone: string;
}>;

export interface ArtistAgendaRepositoryPort {
  listUpcoming(input: Readonly<{ nowUtc: string; limit: number }>): Promise<readonly ArtistAgendaItem[]>;
}

export function createArtistAgendaService(dependencies: {
  repository: ArtistAgendaRepositoryPort;
  clock?: () => Date;
}) {
  return {
    async listUpcoming(): Promise<readonly ArtistAgendaItem[]> {
      const now = (dependencies.clock ?? (() => new Date()))();
      if (!Number.isFinite(now.getTime())) throw new Error("Server clock is invalid");
      return await dependencies.repository.listUpcoming({
        nowUtc: now.toISOString(),
        limit: ARTIST_AGENDA_LIMIT,
      });
    },
  };
}
