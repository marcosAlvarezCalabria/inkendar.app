import { createClient } from "@supabase/supabase-js";
import { BookingContextNotFoundError, BookingHoldConflictError, type BookingOffer, type BookingOfferManagement, type BookingOfferRepositoryPort, type CreateBookingOfferRecord } from "@inkendar/application";

type Result = Readonly<{ data: unknown; error: unknown }>;
export interface BookingOfferDataGateway {
  getManagement(parameters: Record<string, unknown>): Promise<Result>;
  saveExpiryHours(parameters: Record<string, unknown>): Promise<Result>;
  createOffer(parameters: Record<string, unknown>): Promise<Result>;
  expireDue(parameters: Record<string, unknown>): Promise<Result>;
}

export class SupabaseBookingOfferRepository implements BookingOfferRepositoryPort {
  constructor(private readonly data: BookingOfferDataGateway, private readonly ownerUserId: string) {}
  async getManagement(studioId: string): Promise<BookingOfferManagement> {
    const value = required(await this.data.getManagement(this.params(studioId)));
    return management(object(value), studioId);
  }
  async saveExpiryHours(studioId: string, expiryHours: number): Promise<void> {
    const result = await this.data.saveExpiryHours(this.params(studioId, { p_expiry_hours: expiryHours }));
    if (result.error) failed(result.error);
  }
  async createOffer(input: CreateBookingOfferRecord): Promise<BookingOffer> {
    const value = required(await this.data.createOffer(this.params(input.studioId, { p_tattoo_case_id: input.tattooCaseId, p_artist_profile_id: input.artistProfileId, p_options: input.options, p_now: input.nowUtc })));
    return offer(object(value), input.studioId);
  }
  async expireDue(studioId: string, nowUtc: string): Promise<number> {
    const value = required(await this.data.expireDue(this.params(studioId, { p_now: nowUtc })));
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("Booking offer persistence failed");
    return value;
  }
  private params(studioId: string, extra: Record<string, unknown> = {}) { return { p_studio_id: studioId, p_owner_user_id: this.ownerUserId, ...extra }; }
}

export class SupabaseBookingOfferGateway implements BookingOfferDataGateway {
  constructor(private readonly rpc: (name: string, parameters: Record<string, unknown>) => Promise<Result>) {}
  getManagement = (parameters: Record<string, unknown>) => this.rpc("get_booking_offer_management", parameters);
  saveExpiryHours = (parameters: Record<string, unknown>) => this.rpc("save_booking_offer_expiry_hours", parameters);
  createOffer = (parameters: Record<string, unknown>) => this.rpc("create_booking_offer", parameters);
  expireDue = (parameters: Record<string, unknown>) => this.rpc("expire_booking_offers", parameters);
}

export function createSupabaseBookingOfferRepository(environment: Record<string, string | undefined>, ownerUserId: string): SupabaseBookingOfferRepository {
  const url = environment.SUPABASE_URL?.trim(), key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Booking offer persistence failed");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseBookingOfferRepository(new SupabaseBookingOfferGateway(async (name, parameters) => { const { data, error } = await client.rpc(name, parameters); return { data, error }; }), ownerUserId);
}

function management(row: Record<string, unknown>, studioId: string): BookingOfferManagement {
  const expiryHours = integer(row.expiry_hours);
  return {
    expiryHours,
    cases: array(row.cases).map((value) => { const item = object(value); return { id: string(item.id), summary: string(item.summary), artistProfileId: nullableString(item.artist_profile_id) }; }),
    artists: array(row.artists).map((value) => { const item = object(value); return { id: string(item.id), displayName: string(item.display_name) }; }),
    offers: array(row.offers).map((value) => offer(object(value), studioId)),
  };
}
function offer(row: Record<string, unknown>, studioId: string): BookingOffer {
  const status = row.status;
  if (status !== "OPEN" && status !== "SELECTED_PENDING_CONFIRMATION" && status !== "CONFIRMED" && status !== "EXPIRED") throw new Error("Booking offer persistence failed");
  return { id: string(row.id), studioId, tattooCaseId: string(row.tattoo_case_id), artistProfileId: string(row.artist_profile_id), status, expiresAt: string(row.expires_at), createdAt: string(row.created_at), options: array(row.options).map((value) => { const item = object(value); const optionStatus = item.status; if (optionStatus !== "HELD" && optionStatus !== "SELECTED" && optionStatus !== "CONFIRMED" && optionStatus !== "RELEASED") throw new Error("Booking offer persistence failed"); return { id: string(item.id), startUtc: string(item.start_at), endUtc: string(item.end_at), status: optionStatus }; }) };
}
function required(result: Result): unknown { if (result.error || result.data === null) failed(result.error); return result.data; }
function failed(error: unknown): never { const code = typeof error === "object" && error !== null && "code" in error ? error.code : null; if (code === "23P01") throw new BookingHoldConflictError(); if (code === "P0002") throw new BookingContextNotFoundError(); throw new Error("Booking offer persistence failed"); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Booking offer persistence failed"); return value as Record<string, unknown>; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("Booking offer persistence failed"); return value; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("Booking offer persistence failed"); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error("Booking offer persistence failed"); return value; }
