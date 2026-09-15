import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { GOOGLE_CALENDAR_EVENTS_SCOPE, GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_FREE_BUSY_SCOPE, GoogleCalendarCredentialInvalidError, type GoogleCalendar, type GoogleCalendarAccessRole, type GoogleCalendarProviderPort, type GoogleOAuthSecurityPort, type GoogleTokenProtectorPort } from "@inkendar/application";

export { GoogleCalendarCredentialInvalidError } from "@inkendar/application";

export type GoogleCalendarConfig = Readonly<{ clientId: string; clientSecret: string; redirectUri: string }>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const ALLOWED_REDIRECTS = new Set([
  "http://127.0.0.1:3000/auth/google/callback",
  "https://app.inkendar.es/auth/google/callback",
]);
const TOKEN_AAD = Buffer.from("inkendar:google-calendar:refresh-token:v1", "utf8");

export class GoogleCalendarInfrastructureError extends Error {
  readonly code = "GOOGLE_CALENDAR_INFRASTRUCTURE_FAILED";
  constructor(message = "Google Calendar infrastructure failed") { super(message); this.name = "GoogleCalendarInfrastructureError"; }
}

export function loadGoogleCalendarConfig(environment: Record<string, string | undefined>): GoogleCalendarConfig {
  const clientId = required(environment, "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = required(environment, "GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = required(environment, "GOOGLE_OAUTH_REDIRECT_URI");
  if (!ALLOWED_REDIRECTS.has(redirectUri)) throw new Error("Invalid GOOGLE_OAUTH_REDIRECT_URI");
  return { clientId, clientSecret, redirectUri };
}

export function loadGoogleTokenEncryptionKey(environment: Record<string, string | undefined>): string {
  return required(environment, "GOOGLE_TOKEN_ENCRYPTION_KEY");
}

export class NodeGoogleOAuthSecurity implements GoogleOAuthSecurityPort {
  createState(): string { return randomBytes(32).toString("base64url"); }
  hashState(state: string): string { return createHash("sha256").update(state, "utf8").digest("hex"); }
}

export class AesGcmGoogleTokenProtector implements GoogleTokenProtectorPort {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(encodedKey)) throw new Error("Invalid GOOGLE_TOKEN_ENCRYPTION_KEY");
    let key: Buffer;
    try { key = Buffer.from(encodedKey, "base64"); } catch { throw new Error("Invalid GOOGLE_TOKEN_ENCRYPTION_KEY"); }
    if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) throw new Error("Invalid GOOGLE_TOKEN_ENCRYPTION_KEY");
    this.key = key;
  }

  encrypt(token: string): string {
    if (!token) throw new GoogleCalendarInfrastructureError("Google token encryption failed");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(TOKEN_AAD);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  decrypt(value: string): string {
    try {
      const [version, ivValue, encryptedValue, tagValue, extra] = value.split(".");
      if (version !== "v1" || !ivValue || !encryptedValue || !tagValue || extra !== undefined) throw new Error("invalid envelope");
      const iv = decodeBase64Url(ivValue);
      const encrypted = decodeBase64Url(encryptedValue);
      const tag = decodeBase64Url(tagValue);
      if (iv.byteLength !== 12 || tag.byteLength !== 16 || encrypted.byteLength === 0) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
      throw new GoogleCalendarInfrastructureError("Google token decryption failed");
    }
  }
}

export class GoogleCalendarHttpAdapter implements GoogleCalendarProviderPort {
  constructor(private readonly config: GoogleCalendarConfig, private readonly fetcher: Fetcher = fetch) {}

  createAuthorizationUrl(state: string): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: `${GOOGLE_CALENDAR_LIST_SCOPE} ${GOOGLE_FREE_BUSY_SCOPE} ${GOOGLE_CALENDAR_EVENTS_SCOPE}`,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<Readonly<{ refreshToken: string | null; grantedScopes: readonly string[] }>> {
    const value = await this.postToken(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    }));
    return { refreshToken: nullableString(value.refresh_token), grantedScopes: scopes(value.scope) };
  }

  async listCalendars(refreshToken: string): Promise<readonly GoogleCalendar[]> {
    const token = await this.postToken(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }), true);
    const accessToken = string(token.access_token);
    const calendars: GoogleCalendar[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(CALENDAR_LIST_ENDPOINT);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("fields", "items(id,summary,summaryOverride,timeZone,accessRole,primary),nextPageToken");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      const payload = await json(response);
      const items = Array.isArray(payload.items) ? payload.items : [];
      calendars.push(...items.map(calendar));
      pageToken = nullableString(payload.nextPageToken);
      if (!pageToken) return calendars;
    }
    throw new GoogleCalendarInfrastructureError();
  }

  async revokeToken(refreshToken: string): Promise<void> {
    const response = await this.fetcher(REVOCATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ token: refreshToken }),
    });
    if (!response.ok) throw new GoogleCalendarInfrastructureError();
  }

  private async postToken(body: URLSearchParams, invalidGrantMeansCredentialInvalid = false): Promise<Record<string, unknown>> {
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    return json(response, invalidGrantMeansCredentialInvalid);
  }
}

async function json(response: Response, invalidGrantMeansCredentialInvalid = false): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new GoogleCalendarInfrastructureError();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleCalendarInfrastructureError();
  const payload = value as Record<string, unknown>;
  if (!response.ok) {
    if (invalidGrantMeansCredentialInvalid && payload.error === "invalid_grant") throw new GoogleCalendarCredentialInvalidError();
    throw new GoogleCalendarInfrastructureError();
  }
  return payload;
}
function calendar(value: unknown): GoogleCalendar {
  const row = object(value);
  const accessRole = role(row.accessRole);
  return {
    id: string(row.id),
    summary: optionalString(row.summaryOverride) ?? string(row.summary),
    timeZone: optionalString(row.timeZone),
    accessRole,
    primary: row.primary === true,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleCalendarInfrastructureError();
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new GoogleCalendarInfrastructureError(); return value; }
function nullableString(value: unknown): string | null { return value === undefined || value === null ? null : string(value); }
function optionalString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function scopes(value: unknown): readonly string[] { return typeof value === "string" ? value.split(/\s+/u).filter(Boolean) : []; }
function role(value: unknown): GoogleCalendarAccessRole {
  if (value === "freeBusyReader" || value === "reader" || value === "writer" || value === "writerWithoutPrivateAccess" || value === "owner") return value;
  throw new GoogleCalendarInfrastructureError();
}
function decodeBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid base64url");
  return decoded;
}
function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing server environment: ${name}`);
  return value;
}
