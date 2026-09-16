import { describe, expect, it, vi } from "vitest";

import { SupabaseArtistAgendaRepository, type ArtistAgendaDataGateway } from "./supabase-artist-agenda.js";

describe("Supabase artist agenda repository", () => {
  it("calls the identity-bound RPC and maps only the minimal contract", async () => {
    const listUpcoming = vi.fn(async () => ({
      data: [{
        start_at: "2026-09-20T09:00:00.000Z",
        end_at: "2026-09-20T10:00:00.000Z",
        customer_display_name: "Cliente sintético",
        case_summary: "Pieza floral",
        body_area: "Brazo",
        size: null,
        time_zone: "Europe/Dublin",
        appointment_id: "forbidden",
        email: "private@example.test",
      }],
      error: null,
    }));
    const gateway: ArtistAgendaDataGateway = { listUpcoming };
    const repository = new SupabaseArtistAgendaRepository(gateway);

    const result = await repository.listUpcoming({ nowUtc: "2026-09-20T08:00:00.000Z", limit: 50 });

    expect(listUpcoming).toHaveBeenCalledWith({ p_now: "2026-09-20T08:00:00.000Z", p_limit: 50 });
    expect(result).toEqual([{
      startUtc: "2026-09-20T09:00:00.000Z",
      endUtc: "2026-09-20T10:00:00.000Z",
      customerDisplayName: "Cliente sintético",
      caseSummary: "Pieza floral",
      bodyArea: "Brazo",
      size: null,
      timeZone: "Europe/Dublin",
    }]);
    expect(JSON.stringify(result)).not.toMatch(/appointment|email|forbidden/iu);
  });

  it("fails closed for malformed or failed persistence results", async () => {
    const failed = new SupabaseArtistAgendaRepository({ listUpcoming: vi.fn(async () => ({ data: null, error: { code: "42501" } })) });
    await expect(failed.listUpcoming({ nowUtc: "2026-09-20T08:00:00.000Z", limit: 50 })).rejects.toThrow("Artist agenda persistence failed");

    const malformed = new SupabaseArtistAgendaRepository({ listUpcoming: vi.fn(async () => ({ data: [{ start_at: "not-a-time" }], error: null })) });
    await expect(malformed.listUpcoming({ nowUtc: "2026-09-20T08:00:00.000Z", limit: 50 })).rejects.toThrow("Artist agenda persistence failed");
  });
});
