import { createClient } from "@supabase/supabase-js";
import { BookingConfirmationMismatchError, type BookingConfirmationClaim, type BookingConfirmationContext, type BookingConfirmationRepositoryPort, type GoogleConnectionStatus } from "@inkendar/application";
import { normalizePublicBookingOfferHash } from "@inkendar/domain";

type Result = Readonly<{ data: unknown; error: unknown }>;
export interface BookingConfirmationDataGateway {
  getContext(parameters: Record<string, unknown>): Promise<Result>;
  claim(parameters: Record<string, unknown>): Promise<Result>;
  beginInsert(parameters: Record<string, unknown>): Promise<Result>;
  releaseClaim(parameters: Record<string, unknown>): Promise<Result>;
  finalize(parameters: Record<string, unknown>): Promise<Result>;
  markReauthRequired(parameters: Record<string, unknown>): Promise<Result>;
}

export class SupabaseBookingConfirmationRepository implements BookingConfirmationRepositoryPort {
  constructor(private readonly data: BookingConfirmationDataGateway) {}

  async getContext(input: Readonly<{ tokenHash: string; nowUtc: string }>): Promise<BookingConfirmationContext | null> {
    const result = await this.data.getContext({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_now: input.nowUtc });
    if (result.error) failed();
    if (result.data === null) return null;
    const row = object(result.data), connectionValue = row.connection, finalizedValue = row.finalized;
    return {
      state: confirmationState(row.state), studioId: string(row.studio_id), optionId: string(row.option_id),
      startUtc: timestamp(row.start_at), endUtc: timestamp(row.end_at), calendarId: nullableString(row.calendar_id),
      connection: connectionValue === null ? null : connection(object(connectionValue)),
      finalized: finalizedValue === null ? null : finalized(object(finalizedValue)),
    };
  }

  async claim(input: Readonly<{ tokenHash: string; eventId: string; correlation: string; nowUtc: string }>): Promise<BookingConfirmationClaim | null> {
    const result = await this.data.claim({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_event_id: input.eventId, p_correlation: input.correlation, p_now: input.nowUtc });
    if (result.error) claimFailed(result.error);
    if (result.data === null) return null;
    const row = object(result.data), kind = string(row.kind);
    if (kind === "BUSY" || kind === "RECONNECT_REQUIRED") return { kind };
    if (kind !== "CLAIMED") failed();
    const connectionValue = object(row.connection), finalizedValue = row.finalized;
    return {
      kind, mode: claimMode(row.mode), leaseId: string(row.lease_id), studioId: string(row.studio_id), optionId: string(row.option_id),
      startUtc: timestamp(row.start_at), endUtc: timestamp(row.end_at), calendarId: string(row.calendar_id), eventId: string(row.event_id),
      correlation: string(row.correlation), connection: connection(connectionValue),
      finalized: finalizedValue === null ? null : finalized(object(finalizedValue)),
    };
  }

  async beginInsert(input: Readonly<{ tokenHash: string; leaseId: string; nowUtc: string }>): Promise<boolean> {
    const result = await this.data.beginInsert({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_lease_id: input.leaseId, p_now: input.nowUtc });
    if (result.error || typeof result.data !== "boolean") failed();
    return result.data;
  }

  async releaseClaim(input: Readonly<{ tokenHash: string; leaseId: string; nowUtc: string }>): Promise<void> {
    const result = await this.data.releaseClaim({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_lease_id: input.leaseId, p_now: input.nowUtc });
    if (result.error) failed();
  }

  async finalize(input: Readonly<{ tokenHash: string; leaseId: string; connectionId: string; calendarId: string; eventId: string; correlation: string; nowUtc: string }>): Promise<Readonly<{ confirmedAt: string }>> {
    const result = await this.data.finalize({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_lease_id: input.leaseId, p_connection_id: input.connectionId, p_calendar_id: input.calendarId, p_event_id: input.eventId, p_correlation: input.correlation, p_now: input.nowUtc });
    if (result.error || result.data === null) finalizationFailed(result.error);
    return { confirmedAt: timestamp(object(result.data).confirmed_at) };
  }

  async markReauthRequired(studioId: string, connectionId: string, credentialGeneration: number): Promise<void> {
    const result = await this.data.markReauthRequired({ p_studio_id: studioId, p_connection_id: connectionId, p_credential_generation: credentialGeneration });
    if (result.error) failed();
  }
}

export class SupabaseBookingConfirmationGateway implements BookingConfirmationDataGateway {
  constructor(private readonly rpc: (name: string, parameters: Record<string, unknown>) => Promise<Result>) {}
  getContext = (parameters: Record<string, unknown>) => this.rpc("get_public_booking_confirmation_context", parameters);
  claim = (parameters: Record<string, unknown>) => this.rpc("claim_public_booking_confirmation", parameters);
  beginInsert = (parameters: Record<string, unknown>) => this.rpc("begin_public_booking_confirmation_insert", parameters);
  releaseClaim = (parameters: Record<string, unknown>) => this.rpc("release_public_booking_confirmation_claim", parameters);
  finalize = (parameters: Record<string, unknown>) => this.rpc("finalize_public_booking_confirmation", parameters);
  markReauthRequired = (parameters: Record<string, unknown>) => this.rpc("mark_booking_confirmation_reauth_required", parameters);
}

export function createSupabaseBookingConfirmationRepository(environment: Record<string, string | undefined>): SupabaseBookingConfirmationRepository {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) failed();
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseBookingConfirmationRepository(new SupabaseBookingConfirmationGateway(async (name, parameters) => { const { data, error } = await client.rpc(name, parameters); return { data, error }; }));
}

function connection(row: Record<string, unknown>) { return { id: string(row.id), status: status(row.status), encryptedRefreshToken: nullableString(row.refresh_token_ciphertext), grantedScopes: stringArray(row.granted_scopes), credentialGeneration: positiveInteger(row.credential_generation) }; }
function finalized(row: Record<string, unknown>) { return { eventId: string(row.event_id), correlation: string(row.correlation), confirmedAt: timestamp(row.confirmed_at) }; }
function confirmationState(value: unknown): "PENDING" | "CONFIRMED" { if (value !== "PENDING" && value !== "CONFIRMED") failed(); return value; }
function claimMode(value: unknown): "INSERT_OR_RECONCILE" | "RECONCILE_ONLY" { if (value !== "INSERT_OR_RECONCILE" && value !== "RECONCILE_ONLY") failed(); return value; }
function status(value: unknown): GoogleConnectionStatus { if (value !== "ACTIVE" && value !== "REAUTH_REQUIRED" && value !== "DISCONNECTED") failed(); return value; }
function claimFailed(error: unknown): never { if (errorCode(error) === "P0003") throw new BookingConfirmationMismatchError(); failed(); }
function finalizationFailed(error: unknown): never { if (errorCode(error) === "P0003") throw new BookingConfirmationMismatchError(); failed(); }
function errorCode(error: unknown): unknown { return typeof error === "object" && error !== null && "code" in error ? error.code : null; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) failed(); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) failed(); return value as string[]; }
function positiveInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) failed(); return value; }
function timestamp(value: unknown): string { const parsed = new Date(string(value)); if (!Number.isFinite(parsed.getTime())) failed(); return parsed.toISOString(); }
function failed(): never { throw new Error("Booking confirmation persistence failed"); }
