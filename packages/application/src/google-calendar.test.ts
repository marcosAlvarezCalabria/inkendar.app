import { describe, expect, it, vi } from "vitest";

import {
  GoogleCalendarConnectionUnavailableError,
  GoogleCalendarCredentialInvalidError,
  GoogleCalendarNotAssignableError,
  GoogleOAuthAttemptInvalidError,
  GoogleOAuthGrantIncompleteError,
  createGoogleCalendarService,
  type GoogleCalendarProviderPort,
  type GoogleCalendarRepositoryPort,
  type GoogleOAuthSecurityPort,
  type GoogleTokenProtectorPort,
} from "./google-calendar.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const artistId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-14T10:00:00.000Z");
const state = "synthetic-oauth-state-with-at-least-32-chars";
const requiredScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

function dependencies() {
  const repository: GoogleCalendarRepositoryPort = {
    createAttempt: vi.fn(async () => undefined),
    consumeAttempt: vi.fn(async () => true),
    getConnection: vi.fn(async () => null),
    activateConnection: vi.fn(async () => undefined),
    markReauthRequired: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    listArtistsWithAssignments: vi.fn(async () => [{ id: artistId, displayName: "Ana", calendarId: null }]),
    assignCalendar: vi.fn(async () => undefined),
  };
  const provider: GoogleCalendarProviderPort = {
    createAuthorizationUrl: vi.fn((state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    exchangeCode: vi.fn(async () => ({ refreshToken: "refresh-secret", grantedScopes: [requiredScope] })),
    listCalendars: vi.fn(async () => [
      { id: "artist@example.test", summary: "Ana", timeZone: "Europe/Madrid", accessRole: "writerWithoutPrivateAccess" as const, primary: false },
      { id: "read-only@example.test", summary: "Consulta", timeZone: null, accessRole: "reader" as const, primary: false },
    ]),
    revokeToken: vi.fn(async () => undefined),
  };
  const security: GoogleOAuthSecurityPort = { createState: vi.fn(() => state), hashState: vi.fn(() => "state-hash") };
  const tokens: GoogleTokenProtectorPort = { encrypt: vi.fn(() => "v1.ciphertext"), decrypt: vi.fn(() => "refresh-secret") };
  return { repository, provider, security, tokens };
}

describe("Google Calendar connection service", () => {
  it("stores only a bounded one-use state hash before creating the authorization URL", async () => {
    const deps = dependencies();
    const service = createGoogleCalendarService(deps);

    const url = await service.beginConnection(studioId, userId, now);

    expect(deps.repository.createAttempt).toHaveBeenCalledWith({
      stateHash: "state-hash",
      studioId,
      userId,
      expiresAt: "2026-09-14T10:10:00.000Z",
    });
    expect(deps.repository.createAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ state }));
    expect(deps.provider.createAuthorizationUrl).toHaveBeenCalledWith(state);
    expect(url).toContain("accounts.google.com");
  });

  it("consumes state before exchanging the code and stores only an encrypted refresh token", async () => {
    const deps = dependencies();
    const service = createGoogleCalendarService(deps);

    await service.completeConnection(studioId, userId, state, "authorization-code", now);

    expect(deps.repository.consumeAttempt).toHaveBeenCalledWith({ stateHash: "state-hash", studioId, userId, now: now.toISOString() });
    expect(deps.provider.exchangeCode).toHaveBeenCalledWith("authorization-code");
    expect(deps.repository.activateConnection).toHaveBeenCalledWith({
      studioId,
      encryptedRefreshToken: "v1.ciphertext",
      grantedScopes: [requiredScope],
    });
    expect(deps.repository.activateConnection).not.toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "refresh-secret" }));
  });

  it("does not contact Google when state is invalid or already consumed", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.consumeAttempt).mockResolvedValueOnce(false);
    const service = createGoogleCalendarService(deps);

    await expect(service.completeConnection(studioId, userId, state, "authorization-code", now)).rejects.toBeInstanceOf(GoogleOAuthAttemptInvalidError);
    expect(deps.provider.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a grant without refresh token or the exact CalendarList scope", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.exchangeCode).mockResolvedValueOnce({ refreshToken: null, grantedScopes: [requiredScope] });
    const service = createGoogleCalendarService(deps);
    await expect(service.completeConnection(studioId, userId, state, "code", now)).rejects.toBeInstanceOf(GoogleOAuthGrantIncompleteError);
    expect(deps.repository.activateConnection).not.toHaveBeenCalled();
  });

  it("lists minimal metadata and only assigns a writable calendar to an own-studio artist", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getConnection).mockResolvedValue({
      id: "81000000-0000-4000-8000-000000000001",
      studioId,
      status: "ACTIVE",
      encryptedRefreshToken: "v1.ciphertext",
      grantedScopes: [requiredScope],
    });
    const service = createGoogleCalendarService(deps);

    const view = await service.getManagementView(studioId);
    await service.assignCalendar(studioId, artistId, "artist@example.test");

    expect(view.calendars[0]).toEqual({ id: "artist@example.test", summary: "Ana", timeZone: "Europe/Madrid", accessRole: "writerWithoutPrivateAccess", primary: false });
    expect(deps.repository.assignCalendar).toHaveBeenCalledWith(studioId, artistId, "artist@example.test");
    await expect(service.assignCalendar(studioId, artistId, "read-only@example.test")).rejects.toBeInstanceOf(GoogleCalendarNotAssignableError);
  });

  it("marks only proven invalid credentials for reauthorization while preserving assignments", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getConnection).mockResolvedValue({ id: "81000000-0000-4000-8000-000000000001", studioId, status: "ACTIVE", encryptedRefreshToken: "v1.ciphertext", grantedScopes: [requiredScope] });
    vi.mocked(deps.provider.listCalendars).mockRejectedValueOnce(new GoogleCalendarCredentialInvalidError());
    const service = createGoogleCalendarService(deps);

    await expect(service.getManagementView(studioId)).resolves.toMatchObject({ connectionStatus: "REAUTH_REQUIRED", artists: [{ id: artistId }] });
    expect(deps.repository.markReauthRequired).toHaveBeenCalledWith(studioId);
  });

  it("surfaces transient provider failures without changing connection or assignments", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getConnection).mockResolvedValue({ id: "81000000-0000-4000-8000-000000000001", studioId, status: "ACTIVE", encryptedRefreshToken: "v1.ciphertext", grantedScopes: [requiredScope] });
    vi.mocked(deps.provider.listCalendars).mockRejectedValueOnce(new Error("HTTP 503 with provider detail"));
    const service = createGoogleCalendarService(deps);

    await expect(service.getManagementView(studioId)).rejects.toBeInstanceOf(GoogleCalendarConnectionUnavailableError);
    expect(deps.repository.markReauthRequired).not.toHaveBeenCalled();
    expect(deps.repository.assignCalendar).not.toHaveBeenCalled();
  });

  it("revokes a retained token in REAUTH_REQUIRED and disconnects locally even if revocation fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.getConnection).mockResolvedValueOnce({ id: "81000000-0000-4000-8000-000000000001", studioId, status: "REAUTH_REQUIRED", encryptedRefreshToken: "v1.ciphertext", grantedScopes: [requiredScope] });
    vi.mocked(deps.provider.revokeToken).mockRejectedValueOnce(new Error("provider unavailable"));
    const service = createGoogleCalendarService(deps);

    await service.disconnect(studioId);

    expect(deps.provider.revokeToken).toHaveBeenCalledWith("refresh-secret");
    expect(deps.repository.disconnect).toHaveBeenCalledWith(studioId);
  });
});
