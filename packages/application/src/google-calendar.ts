
export const GOOGLE_CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

export type GoogleConnectionStatus = "ACTIVE" | "REAUTH_REQUIRED" | "DISCONNECTED";
export type GoogleCalendarAccessRole = "freeBusyReader" | "reader" | "writer" | "writerWithoutPrivateAccess" | "owner";

export type GoogleCalendar = Readonly<{
  id: string;
  summary: string;
  timeZone: string | null;
  accessRole: GoogleCalendarAccessRole;
  primary: boolean;
}>;

export type GoogleCalendarConnection = Readonly<{
  id: string;
  studioId: string;
  status: GoogleConnectionStatus;
  encryptedRefreshToken: string | null;
  grantedScopes: readonly string[];
  credentialGeneration: number;
}>;

export type ArtistCalendarAssignment = Readonly<{
  id: string;
  displayName: string;
  calendarId: string | null;
}>;

export interface GoogleCalendarRepositoryPort {
  createAttempt(input: Readonly<{ stateHash: string; studioId: string; userId: string; expiresAt: string }>): Promise<void>;
  consumeAttempt(input: Readonly<{ stateHash: string; studioId: string; userId: string; now: string }>): Promise<boolean>;
  getConnection(studioId: string): Promise<GoogleCalendarConnection | null>;
  activateConnection(input: Readonly<{ studioId: string; encryptedRefreshToken: string; grantedScopes: readonly string[] }>): Promise<void>;
  markReauthRequired(studioId: string, credentialGeneration: number): Promise<void>;
  disconnect(studioId: string): Promise<void>;
  listArtistsWithAssignments(studioId: string): Promise<readonly ArtistCalendarAssignment[]>;
  assignCalendar(studioId: string, artistProfileId: string, calendarId: string | null, accessRole: "writer" | "owner" | null): Promise<void>;
}

export interface GoogleCalendarProviderPort {
  createAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<Readonly<{ refreshToken: string | null; grantedScopes: readonly string[] }>>;
  listCalendars(refreshToken: string): Promise<readonly GoogleCalendar[]>;
  revokeToken(refreshToken: string): Promise<void>;
}

export interface GoogleOAuthSecurityPort {
  createState(): string;
  hashState(state: string): string;
}

export interface GoogleTokenProtectorPort {
  encrypt(token: string): string;
  decrypt(value: string): string;
}

export class GoogleOAuthAttemptInvalidError extends Error {
  readonly code = "GOOGLE_OAUTH_ATTEMPT_INVALID";
  constructor() { super("Google OAuth attempt is invalid"); this.name = "GoogleOAuthAttemptInvalidError"; }
}
export class GoogleOAuthGrantIncompleteError extends Error {
  readonly code = "GOOGLE_OAUTH_GRANT_INCOMPLETE";
  constructor() { super("Google OAuth grant is incomplete"); this.name = "GoogleOAuthGrantIncompleteError"; }
}
export type GoogleOAuthProviderErrorCategory =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "redirect_uri_mismatch"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "other";
export class GoogleOAuthProviderExchangeError extends Error {
  readonly code = "GOOGLE_OAUTH_PROVIDER_EXCHANGE_FAILED";
  constructor(readonly category: GoogleOAuthProviderErrorCategory) {
    super("Google OAuth provider exchange failed");
    this.name = "GoogleOAuthProviderExchangeError";
  }
}
export type GoogleOAuthCompletionFailurePhase =
  | "attempt-consumption"
  | "provider-exchange"
  | "token-protection"
  | "connection-persistence";
export class GoogleOAuthCompletionFailedError extends Error {
  readonly code = "GOOGLE_OAUTH_COMPLETION_FAILED";
  constructor(
    readonly phase: GoogleOAuthCompletionFailurePhase,
    readonly providerError?: GoogleOAuthProviderErrorCategory,
  ) {
    super("Google OAuth completion failed");
    this.name = "GoogleOAuthCompletionFailedError";
  }
}
export class GoogleCalendarNotAssignableError extends Error {
  readonly code = "GOOGLE_CALENDAR_NOT_ASSIGNABLE";
  constructor() { super("Google calendar is not assignable"); this.name = "GoogleCalendarNotAssignableError"; }
}
export class GoogleCalendarConnectionUnavailableError extends Error {
  readonly code = "GOOGLE_CALENDAR_CONNECTION_UNAVAILABLE";
  constructor() { super("Google Calendar connection is unavailable"); this.name = "GoogleCalendarConnectionUnavailableError"; }
}
export class GoogleCalendarCredentialInvalidError extends Error {
  readonly code = "GOOGLE_CALENDAR_CREDENTIAL_INVALID";
  constructor() { super("Google Calendar credential is invalid"); this.name = "GoogleCalendarCredentialInvalidError"; }
}
export class InvalidGoogleCalendarInputError extends Error {
  readonly code = "INVALID_GOOGLE_CALENDAR_INPUT";
  constructor() { super("Google Calendar input is invalid"); this.name = "InvalidGoogleCalendarInputError"; }
}

type Dependencies = Readonly<{
  repository: GoogleCalendarRepositoryPort;
  provider: GoogleCalendarProviderPort;
  security: GoogleOAuthSecurityPort;
  tokens: GoogleTokenProtectorPort;
}>;

export function createGoogleCalendarService(dependencies: Dependencies) {
  async function active(studioIdValue: string): Promise<Readonly<{ connection: GoogleCalendarConnection; refreshToken: string }>> {
    const studioId = resource("studioId", studioIdValue);
    const connection = await dependencies.repository.getConnection(studioId);
    if (!connection || connection.studioId !== studioId || connection.status !== "ACTIVE" || !connection.encryptedRefreshToken) {
      throw new GoogleCalendarConnectionUnavailableError();
    }
    return { connection, refreshToken: dependencies.tokens.decrypt(connection.encryptedRefreshToken) };
  }

  return {
    async beginConnection(studioIdValue: string, userIdValue: string, now: Date): Promise<string> {
      const studioId = resource("studioId", studioIdValue);
      const userId = resource("userId", userIdValue);
      validDate(now);
      const state = dependencies.security.createState();
      if (state.length < 32 || state.length > 512) throw new GoogleOAuthAttemptInvalidError();
      await dependencies.repository.createAttempt({
        stateHash: dependencies.security.hashState(state),
        studioId,
        userId,
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      });
      return dependencies.provider.createAuthorizationUrl(state);
    },

    async cancelConnectionAttempt(studioIdValue: string, userIdValue: string, stateValue: string, now: Date): Promise<void> {
      const studioId = resource("studioId", studioIdValue);
      const userId = resource("userId", userIdValue);
      const state = bounded(stateValue, 32, 512);
      validDate(now);
      const consumed = await dependencies.repository.consumeAttempt({
        stateHash: dependencies.security.hashState(state), studioId, userId, now: now.toISOString(),
      });
      if (!consumed) throw new GoogleOAuthAttemptInvalidError();
    },

    async completeConnection(studioIdValue: string, userIdValue: string, stateValue: string, codeValue: string, now: Date): Promise<void> {
      const studioId = resource("studioId", studioIdValue);
      const userId = resource("userId", userIdValue);
      const state = bounded(stateValue, 32, 512);
      const code = bounded(codeValue, 1, 4096);
      validDate(now);
      let consumed: boolean;
      try {
        consumed = await dependencies.repository.consumeAttempt({
          stateHash: dependencies.security.hashState(state), studioId, userId, now: now.toISOString(),
        });
      } catch {
        throw new GoogleOAuthCompletionFailedError("attempt-consumption");
      }
      if (!consumed) throw new GoogleOAuthAttemptInvalidError();
      let grant: Readonly<{ refreshToken: string | null; grantedScopes: readonly string[] }>;
      try {
        grant = await dependencies.provider.exchangeCode(code);
      } catch (error) {
        const providerError = error instanceof GoogleOAuthProviderExchangeError ? error.category : "other";
        throw new GoogleOAuthCompletionFailedError("provider-exchange", providerError);
      }
      const scopes = [...new Set(grant.grantedScopes)].sort();
      if (!grant.refreshToken || !scopes.includes(GOOGLE_CALENDAR_LIST_SCOPE)) throw new GoogleOAuthGrantIncompleteError();
      let encryptedRefreshToken: string;
      try {
        encryptedRefreshToken = dependencies.tokens.encrypt(grant.refreshToken);
      } catch {
        throw new GoogleOAuthCompletionFailedError("token-protection");
      }
      try {
        await dependencies.repository.activateConnection({ studioId, encryptedRefreshToken, grantedScopes: scopes });
      } catch {
        throw new GoogleOAuthCompletionFailedError("connection-persistence");
      }
    },

    async getManagementView(studioIdValue: string): Promise<Readonly<{ connectionStatus: GoogleConnectionStatus | "NOT_CONNECTED"; calendars: readonly GoogleCalendar[]; artists: readonly ArtistCalendarAssignment[] }>> {
      const studioId = resource("studioId", studioIdValue);
      const [connection, artists] = await Promise.all([
        dependencies.repository.getConnection(studioId), dependencies.repository.listArtistsWithAssignments(studioId),
      ]);
      if (!connection || connection.status !== "ACTIVE" || !connection.encryptedRefreshToken) {
        return { connectionStatus: connection?.status ?? "NOT_CONNECTED", calendars: [], artists };
      }
      try {
        const calendars = await dependencies.provider.listCalendars(dependencies.tokens.decrypt(connection.encryptedRefreshToken));
        return { connectionStatus: "ACTIVE", calendars, artists };
      } catch (error) {
        if (error instanceof GoogleCalendarCredentialInvalidError) {
          await dependencies.repository.markReauthRequired(studioId, connection.credentialGeneration);
          return { connectionStatus: "REAUTH_REQUIRED", calendars: [], artists };
        }
        throw new GoogleCalendarConnectionUnavailableError();
      }
    },

    async assignCalendar(studioIdValue: string, artistIdValue: string, calendarIdValue: string | null): Promise<void> {
      const studioId = resource("studioId", studioIdValue);
      const artistId = resource("artistProfileId", artistIdValue);
      if (calendarIdValue === null || calendarIdValue.trim() === "") {
        await dependencies.repository.assignCalendar(studioId, artistId, null, null);
        return;
      }
      const calendarId = calendarIdentifier(calendarIdValue);
      const { refreshToken } = await active(studioId);
      const calendars = await dependencies.provider.listCalendars(refreshToken);
      const selected = calendars.find((calendar) => calendar.id === calendarId);
      if (!selected || (selected.accessRole !== "writer" && selected.accessRole !== "owner")) {
        throw new GoogleCalendarNotAssignableError();
      }
      await dependencies.repository.assignCalendar(studioId, artistId, calendarId, selected.accessRole);
    },

    async disconnect(studioIdValue: string): Promise<void> {
      const studioId = resource("studioId", studioIdValue);
      const connection = await dependencies.repository.getConnection(studioId);
      if (connection?.encryptedRefreshToken) {
        try { await dependencies.provider.revokeToken(dependencies.tokens.decrypt(connection.encryptedRefreshToken)); } catch { /* local disconnect remains authoritative */ }
      }
      await dependencies.repository.disconnect(studioId);
    },
  };
}

function resource(_name: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) throw new InvalidGoogleCalendarInputError();
  return normalized;
}
function bounded(value: string, min: number, max: number): string {
  const result = value.trim();
  const hasControlCharacter = Array.from(result).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (result.length < min || result.length > max || hasControlCharacter) throw new InvalidGoogleCalendarInputError();
  return result;
}
function calendarIdentifier(value: string): string { return bounded(value, 1, 1024); }
function validDate(value: Date): void { if (!Number.isFinite(value.getTime())) throw new InvalidGoogleCalendarInputError(); }
