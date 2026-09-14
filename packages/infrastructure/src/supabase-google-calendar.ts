import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ArtistCalendarAssignment, GoogleCalendarConnection, GoogleCalendarRepositoryPort, GoogleConnectionStatus } from "@inkendar/application";

type DataResult = Readonly<{ data: unknown; error: unknown }>;
type Parameters = Readonly<Record<string, string | null | readonly string[]>>;

export interface GoogleCalendarDataGateway {
  createAttempt(parameters: Parameters): Promise<DataResult>;
  consumeAttempt(parameters: Parameters): Promise<DataResult>;
  getConnection(parameters: Parameters): Promise<DataResult>;
  activateConnection(parameters: Parameters): Promise<DataResult>;
  markReauthRequired(parameters: Parameters): Promise<DataResult>;
  disconnect(parameters: Parameters): Promise<DataResult>;
  listArtistsWithAssignments(parameters: Parameters): Promise<DataResult>;
  assignCalendar(parameters: Parameters): Promise<DataResult>;
}

export class SupabaseGoogleCalendarGateway implements GoogleCalendarDataGateway {
  constructor(private readonly client: SupabaseClient) {}
  createAttempt(parameters: Parameters): Promise<DataResult> { return this.rpc("create_google_oauth_attempt", parameters); }
  consumeAttempt(parameters: Parameters): Promise<DataResult> { return this.rpc("consume_google_oauth_attempt", parameters); }
  getConnection(parameters: Parameters): Promise<DataResult> { return this.rpc("get_google_calendar_connection", parameters); }
  activateConnection(parameters: Parameters): Promise<DataResult> { return this.rpc("activate_google_calendar_connection", parameters); }
  markReauthRequired(parameters: Parameters): Promise<DataResult> { return this.rpc("mark_google_calendar_reauth_required", parameters); }
  disconnect(parameters: Parameters): Promise<DataResult> { return this.rpc("disconnect_google_calendar", parameters); }
  listArtistsWithAssignments(parameters: Parameters): Promise<DataResult> { return this.rpc("list_artist_calendar_assignments", parameters); }
  assignCalendar(parameters: Parameters): Promise<DataResult> { return this.rpc("assign_artist_calendar", parameters); }
  private async rpc(name: string, parameters: Parameters): Promise<DataResult> {
    const { data, error } = await this.client.rpc(name, parameters);
    return { data, error };
  }
}

export class SupabaseGoogleCalendarError extends Error {
  readonly code = "SUPABASE_GOOGLE_CALENDAR_FAILED";
  constructor() { super("Google Calendar persistence failed"); this.name = "SupabaseGoogleCalendarError"; }
}

export class SupabaseGoogleCalendarRepository implements GoogleCalendarRepositoryPort {
  constructor(private readonly data: GoogleCalendarDataGateway, private readonly ownerUserId: string) {}

  async createAttempt(input: Readonly<{ stateHash: string; studioId: string; userId: string; expiresAt: string }>): Promise<void> {
    if (input.userId !== this.ownerUserId) throw new SupabaseGoogleCalendarError();
    await this.voidResult(this.data.createAttempt({
      p_state_hash: input.stateHash,
      p_studio_id: input.studioId,
      p_owner_user_id: this.ownerUserId,
      p_expires_at: input.expiresAt,
    }));
  }

  async consumeAttempt(input: Readonly<{ stateHash: string; studioId: string; userId: string; now: string }>): Promise<boolean> {
    if (input.userId !== this.ownerUserId) throw new SupabaseGoogleCalendarError();
    const result = await this.data.consumeAttempt({
      p_state_hash: input.stateHash,
      p_studio_id: input.studioId,
      p_owner_user_id: this.ownerUserId,
      p_now: input.now,
    });
    if (result.error || typeof result.data !== "boolean") throw new SupabaseGoogleCalendarError();
    return result.data;
  }

  async getConnection(studioId: string): Promise<GoogleCalendarConnection | null> {
    const result = await this.data.getConnection(this.owner(studioId));
    if (result.error || !Array.isArray(result.data) || result.data.length > 1) throw new SupabaseGoogleCalendarError();
    if (result.data.length === 0) return null;
    const row = object(result.data[0]);
    const mapped = {
      id: string(row.id),
      studioId: string(row.studio_id),
      status: status(row.status),
      encryptedRefreshToken: nullableString(row.refresh_token_ciphertext),
      grantedScopes: stringArray(row.granted_scopes),
    };
    if (mapped.studioId !== studioId) throw new SupabaseGoogleCalendarError();
    return mapped;
  }

  async activateConnection(input: Readonly<{ studioId: string; encryptedRefreshToken: string; grantedScopes: readonly string[] }>): Promise<void> {
    await this.voidResult(this.data.activateConnection({
      ...this.owner(input.studioId),
      p_refresh_token_ciphertext: input.encryptedRefreshToken,
      p_granted_scopes: input.grantedScopes,
    }));
  }
  async markReauthRequired(studioId: string): Promise<void> { await this.voidResult(this.data.markReauthRequired(this.owner(studioId))); }
  async disconnect(studioId: string): Promise<void> { await this.voidResult(this.data.disconnect(this.owner(studioId))); }

  async listArtistsWithAssignments(studioId: string): Promise<readonly ArtistCalendarAssignment[]> {
    const result = await this.data.listArtistsWithAssignments(this.owner(studioId));
    if (result.error || !Array.isArray(result.data)) throw new SupabaseGoogleCalendarError();
    return result.data.map((value) => {
      const row = object(value);
      return { id: string(row.artist_profile_id), displayName: string(row.display_name), calendarId: nullableString(row.calendar_id) };
    });
  }

  async assignCalendar(studioId: string, artistProfileId: string, calendarId: string | null): Promise<void> {
    await this.voidResult(this.data.assignCalendar({
      ...this.owner(studioId), p_artist_profile_id: artistProfileId, p_calendar_id: calendarId,
    }));
  }

  private owner(studioId: string): Parameters { return { p_studio_id: studioId, p_owner_user_id: this.ownerUserId }; }
  private async voidResult(resultPromise: Promise<DataResult>): Promise<void> {
    const result = await resultPromise;
    if (result.error) throw new SupabaseGoogleCalendarError();
  }
}

export function createSupabaseGoogleCalendarRepository(environment: Record<string, string | undefined>, ownerUserId: string): SupabaseGoogleCalendarRepository {
  const url = required(environment, "SUPABASE_URL");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseGoogleCalendarRepository(new SupabaseGoogleCalendarGateway(client), ownerUserId);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SupabaseGoogleCalendarError();
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new SupabaseGoogleCalendarError(); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) throw new SupabaseGoogleCalendarError();
  return value as string[];
}
function status(value: unknown): GoogleConnectionStatus {
  if (value === "ACTIVE" || value === "REAUTH_REQUIRED" || value === "DISCONNECTED") return value;
  throw new SupabaseGoogleCalendarError();
}
function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim(); if (!value) throw new SupabaseGoogleCalendarError(); return value;
}
