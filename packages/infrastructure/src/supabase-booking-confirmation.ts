import { createClient } from "@supabase/supabase-js";
import { BookingConfirmationMismatchError, type BookingConfirmationContext, type BookingConfirmationRepositoryPort, type GoogleConnectionStatus } from "@inkendar/application";
import { normalizePublicBookingOfferHash } from "@inkendar/domain";

type Result = Readonly<{ data: unknown; error: unknown }>;
export interface BookingConfirmationDataGateway {
  getContext(parameters: Record<string, unknown>): Promise<Result>;
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

  async finalize(input: Readonly<{ tokenHash: string; connectionId: string; calendarId: string; eventId: string; correlation: string; nowUtc: string }>): Promise<Readonly<{ confirmedAt: string }>> {
    const result = await this.data.finalize({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_connection_id: input.connectionId, p_calendar_id: input.calendarId, p_event_id: input.eventId, p_correlation: input.correlation, p_now: input.nowUtc });
    if (result.error || result.data === null) finalizationFailed(result.error);
    return { confirmedAt: timestamp(object(result.data).confirmed_at) };
  }

  async markReauthRequired(studioId: string, connectionId: string): Promise<void> {
    const result = await this.data.markReauthRequired({ p_studio_id: studioId, p_connection_id: connectionId });
    if (result.error) failed();
  }
}

export class SupabaseBookingConfirmationGateway implements BookingConfirmationDataGateway {
  constructor(private readonly rpc: (name: string, parameters: Record<string, unknown>) => Promise<Result>) {}
  getContext = (parameters: Record<string, unknown>) => this.rpc("get_public_booking_confirmation_context", parameters);
  finalize = (parameters: Record<string, unknown>) => this.rpc("finalize_public_booking_confirmation", parameters);
  markReauthRequired = (parameters: Record<string, unknown>) => this.rpc("mark_booking_confirmation_reauth_required", parameters);
}

export function createSupabaseBookingConfirmationRepository(environment: Record<string, string | undefined>): SupabaseBookingConfirmationRepository {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) failed();
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseBookingConfirmationRepository(new SupabaseBookingConfirmationGateway(async (name, parameters) => { const { data, error } = await client.rpc(name, parameters); return { data, error }; }));
}

function connection(row: Record<string, unknown>) { return { id: string(row.id), status: status(row.status), encryptedRefreshToken: nullableString(row.refresh_token_ciphertext), grantedScopes: stringArray(row.granted_scopes) }; }
function finalized(row: Record<string, unknown>) { return { eventId: string(row.event_id), correlation: string(row.correlation), confirmedAt: timestamp(row.confirmed_at) }; }
function confirmationState(value: unknown): "PENDING" | "CONFIRMED" { if (value !== "PENDING" && value !== "CONFIRMED") failed(); return value; }
function status(value: unknown): GoogleConnectionStatus { if (value !== "ACTIVE" && value !== "REAUTH_REQUIRED" && value !== "DISCONNECTED") failed(); return value; }
function finalizationFailed(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "P0003") throw new BookingConfirmationMismatchError();
  failed();
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) failed(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) failed(); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) failed(); return value as string[]; }
function timestamp(value: unknown): string { const parsed = new Date(string(value)); if (!Number.isFinite(parsed.getTime())) failed(); return parsed.toISOString(); }
function failed(): never { throw new Error("Booking confirmation persistence failed"); }
