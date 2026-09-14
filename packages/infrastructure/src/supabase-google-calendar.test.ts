import { describe, expect, it, vi } from "vitest";

import { SupabaseGoogleCalendarRepository, type GoogleCalendarDataGateway } from "./supabase-google-calendar.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

function gateway(): GoogleCalendarDataGateway {
  return {
    createAttempt: vi.fn(async () => ({ data: null, error: null })),
    consumeAttempt: vi.fn(async () => ({ data: true, error: null })),
    getConnection: vi.fn(async () => ({ data: [{ id: "81000000-0000-4000-8000-000000000001", studio_id: studioId, status: "ACTIVE", refresh_token_ciphertext: "v1.cipher", granted_scopes: ["scope"] }], error: null })),
    activateConnection: vi.fn(async () => ({ data: null, error: null })),
    markReauthRequired: vi.fn(async () => ({ data: null, error: null })),
    disconnect: vi.fn(async () => ({ data: null, error: null })),
    listArtistsWithAssignments: vi.fn(async () => ({ data: [{ artist_profile_id: "50000000-0000-4000-8000-000000000001", display_name: "Ana", calendar_id: "ana@example.test" }], error: null })),
    assignCalendar: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase Google Calendar repository", () => {
  it("binds every privileged attempt operation to the authorized owner", async () => {
    const data = gateway();
    const repository = new SupabaseGoogleCalendarRepository(data, userId);
    await repository.createAttempt({ stateHash: "a".repeat(64), studioId, userId, expiresAt: "2026-09-14T10:10:00.000Z" });
    await expect(repository.consumeAttempt({ stateHash: "a".repeat(64), studioId, userId, now: "2026-09-14T10:00:00.000Z" })).resolves.toBe(true);
    expect(data.createAttempt).toHaveBeenCalledWith({ p_state_hash: "a".repeat(64), p_studio_id: studioId, p_owner_user_id: userId, p_expires_at: "2026-09-14T10:10:00.000Z" });
    expect(data.consumeAttempt).toHaveBeenCalledWith({ p_state_hash: "a".repeat(64), p_studio_id: studioId, p_owner_user_id: userId, p_now: "2026-09-14T10:00:00.000Z" });
  });

  it("rejects an attempt user different from the bound owner before persistence", async () => {
    const data = gateway();
    const repository = new SupabaseGoogleCalendarRepository(data, userId);
    await expect(repository.createAttempt({ stateHash: "a".repeat(64), studioId, userId: "10000000-0000-4000-8000-000000000099", expiresAt: "2026-09-14T10:10:00.000Z" })).rejects.toThrow("Google Calendar persistence failed");
    expect(data.createAttempt).not.toHaveBeenCalled();
  });

  it("maps a tenant-scoped connection without exposing provider token fields beyond the encrypted envelope", async () => {
    const data = gateway();
    const repository = new SupabaseGoogleCalendarRepository(data, userId);
    await expect(repository.getConnection(studioId)).resolves.toEqual({
      id: "81000000-0000-4000-8000-000000000001", studioId, status: "ACTIVE", encryptedRefreshToken: "v1.cipher", grantedScopes: ["scope"],
    });
    expect(data.getConnection).toHaveBeenCalledWith({ p_studio_id: studioId, p_owner_user_id: userId });
  });

  it("maps artists and delegates one assignment through the owner-bound RPC", async () => {
    const data = gateway();
    const repository = new SupabaseGoogleCalendarRepository(data, userId);
    await expect(repository.listArtistsWithAssignments(studioId)).resolves.toEqual([{ id: "50000000-0000-4000-8000-000000000001", displayName: "Ana", calendarId: "ana@example.test" }]);
    await repository.assignCalendar(studioId, "50000000-0000-4000-8000-000000000001", null);
    expect(data.assignCalendar).toHaveBeenCalledWith({ p_studio_id: studioId, p_owner_user_id: userId, p_artist_profile_id: "50000000-0000-4000-8000-000000000001", p_calendar_id: null });
  });

  it("rejects cross-tenant rows returned by the privileged boundary", async () => {
    const data = gateway();
    vi.mocked(data.getConnection).mockResolvedValueOnce({ data: [{ id: "81000000-0000-4000-8000-000000000001", studio_id: "20000000-0000-4000-8000-000000000002", status: "ACTIVE", refresh_token_ciphertext: "v1.cipher", granted_scopes: ["scope"] }], error: null });
    const repository = new SupabaseGoogleCalendarRepository(data, userId);
    await expect(repository.getConnection(studioId)).rejects.toThrow("Google Calendar persistence failed");
  });
});
