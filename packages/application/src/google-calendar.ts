
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
export type GoogleOAuthProviderExchangeStage =
  | "network"
  | "non-json-response"
  | "malformed-json-payload"
  | "provider-error"
  | "provider-error-other"
  | "malformed-success-response"
  | "unknown";
export type GoogleOAuthProviderExchangeFailureDetails = Readonly<{
  exchangeStage: GoogleOAuthProviderExchangeStage;
  providerError?: GoogleOAuthProviderErrorCategory;
  httpStatus?: number;
}>;
const GOOGLE_OAUTH_PROVIDER_EXCHANGE_ERROR_CODE = "GOOGLE_OAUTH_PROVIDER_EXCHANGE_FAILED";
export class GoogleOAuthProviderExchangeError extends Error {
  readonly code = GOOGLE_OAUTH_PROVIDER_EXCHANGE_ERROR_CODE;
  readonly details: GoogleOAuthProviderExchangeFailureDetails;
  constructor(details: GoogleOAuthProviderExchangeFailureDetails) {
    super("Google OAuth provider exchange failed");
    this.name = "GoogleOAuthProviderExchangeError";
    this.details = readGoogleOAuthProviderExchangeFailureDetails(details) ?? { exchangeStage: "unknown" };
  }
}
export type GoogleOAuthCompletionFailurePhase =
  | "attempt-consumption"
  | "provider-exchange"
  | "token-protection"
  | "connection-persistence";
export type GoogleOAuthCompletionFailureDetails =
  | Readonly<{ phase: "provider-exchange"; providerExchange: GoogleOAuthProviderExchangeFailureDetails }>
  | Readonly<{ phase: Exclude<GoogleOAuthCompletionFailurePhase, "provider-exchange"> }>;
const GOOGLE_OAUTH_COMPLETION_ERROR_CODE = "GOOGLE_OAUTH_COMPLETION_FAILED";
export class GoogleOAuthCompletionFailedError extends Error {
  readonly code = GOOGLE_OAUTH_COMPLETION_ERROR_CODE;
  constructor(
    readonly phase: GoogleOAuthCompletionFailurePhase,
    readonly providerExchange?: GoogleOAuthProviderExchangeFailureDetails,
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
        const providerExchange = readGoogleOAuthProviderExchangeFailure(error) ?? { exchangeStage: "unknown" };
        throw new GoogleOAuthCompletionFailedError("provider-exchange", providerExchange);
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

export function isGoogleOAuthProviderErrorCategory(value: unknown): value is GoogleOAuthProviderErrorCategory {
  return value === "invalid_request"
    || value === "invalid_client"
    || value === "invalid_grant"
    || value === "redirect_uri_mismatch"
    || value === "unauthorized_client"
    || value === "unsupported_grant_type"
    || value === "other";
}

export function readGoogleOAuthCompletionFailure(error: unknown): GoogleOAuthCompletionFailureDetails | null {
  try {
    if (!error || typeof error !== "object") return null;
    const candidate = error as Record<string, unknown>;
    if (candidate.code !== GOOGLE_OAUTH_COMPLETION_ERROR_CODE || !isGoogleOAuthCompletionFailurePhase(candidate.phase)) return null;
    if (candidate.phase === "provider-exchange") {
      return {
        phase: candidate.phase,
        providerExchange: readGoogleOAuthProviderExchangeFailureDetails(candidate.providerExchange) ?? { exchangeStage: "unknown" },
      };
    }
    return { phase: candidate.phase };
  } catch {
    return null;
  }
}

export function readGoogleOAuthProviderExchangeFailure(error: unknown): GoogleOAuthProviderExchangeFailureDetails | null {
  try {
    if (!error || typeof error !== "object") return null;
    const candidate = error as Record<string, unknown>;
    if (candidate.code !== GOOGLE_OAUTH_PROVIDER_EXCHANGE_ERROR_CODE) return null;
    return readGoogleOAuthProviderExchangeFailureDetails(candidate.details);
  } catch {
    return null;
  }
}

function readGoogleOAuthProviderExchangeFailureDetails(value: unknown): GoogleOAuthProviderExchangeFailureDetails | null {
  try {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (!isGoogleOAuthProviderExchangeStage(candidate.exchangeStage)) return null;
    const status = safeProviderHttpStatus(candidate.httpStatus);
    if (candidate.exchangeStage === "provider-error") {
      if (!isGoogleOAuthProviderErrorCategory(candidate.providerError) || candidate.providerError === "other") {
        return withProviderHttpStatus({ exchangeStage: "provider-error-other", providerError: "other" }, status);
      }
      return withProviderHttpStatus({ exchangeStage: candidate.exchangeStage, providerError: candidate.providerError }, status);
    }
    if (candidate.exchangeStage === "provider-error-other") {
      return withProviderHttpStatus({ exchangeStage: candidate.exchangeStage, providerError: "other" }, status);
    }
    if (candidate.exchangeStage === "non-json-response" || candidate.exchangeStage === "malformed-json-payload") {
      return withProviderHttpStatus({ exchangeStage: candidate.exchangeStage }, status);
    }
    return { exchangeStage: candidate.exchangeStage };
  } catch {
    return null;
  }
}

function withProviderHttpStatus(
  details: GoogleOAuthProviderExchangeFailureDetails,
  status: number | undefined,
): GoogleOAuthProviderExchangeFailureDetails {
  return status === undefined ? details : { ...details, httpStatus: status };
}

function safeProviderHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function isGoogleOAuthProviderExchangeStage(value: unknown): value is GoogleOAuthProviderExchangeStage {
  return value === "network"
    || value === "non-json-response"
    || value === "malformed-json-payload"
    || value === "provider-error"
    || value === "provider-error-other"
    || value === "malformed-success-response"
    || value === "unknown";
}

function isGoogleOAuthCompletionFailurePhase(value: unknown): value is GoogleOAuthCompletionFailurePhase {
  return value === "attempt-consumption"
    || value === "provider-exchange"
    || value === "token-protection"
    || value === "connection-persistence";
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
