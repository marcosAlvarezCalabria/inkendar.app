import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  BookingContextNotFoundError,
  PublicBookingOfferSelectionRejectedError,
  PublicBookingOfferUnavailableError,
  type BookingOfferAccessRepositoryPort,
  type PublicBookingOfferRepositoryPort,
  type PublicBookingOfferView,
  type RotateBookingOfferAccessRecord,
  type SelectPublicBookingOfferRecord,
} from "@inkendar/application";
import { normalizePublicBookingOfferHash, normalizePublicBookingOptionSelector } from "@inkendar/domain";

type Result = Readonly<{ data: unknown; error: unknown }>;

export interface BookingOfferAccessDataGateway {
  rotateAccess(parameters: Record<string, unknown>): Promise<Result>;
  getPublic(parameters: Record<string, unknown>): Promise<Result>;
  selectPublic(parameters: Record<string, unknown>): Promise<Result>;
}

export class SupabaseBookingOfferAccessRepository implements BookingOfferAccessRepositoryPort {
  constructor(private readonly data: BookingOfferAccessDataGateway, private readonly ownerUserId: string) {}

  async rotateAccess(input: RotateBookingOfferAccessRecord): Promise<Readonly<{ expiresAt: string }>> {
    const result = await this.data.rotateAccess({
      p_studio_id: input.studioId,
      p_owner_user_id: this.ownerUserId,
      p_offer_id: input.offerId,
      p_token_hash: normalizePublicBookingOfferHash(input.tokenHash),
      p_now: input.nowUtc,
    });
    if (result.error || result.data === null) ownerFailed(result.error);
    return { expiresAt: timestamp(object(result.data).expires_at) };
  }
}

export class SupabasePublicBookingOfferRepository implements PublicBookingOfferRepositoryPort {
  constructor(private readonly data: BookingOfferAccessDataGateway) {}

  async getByTokenHash(input: Readonly<{ tokenHash: string; nowUtc: string }>): Promise<PublicBookingOfferView | null> {
    const result = await this.data.getPublic({ p_token_hash: normalizePublicBookingOfferHash(input.tokenHash), p_now: input.nowUtc });
    if (result.error) throw new Error("Public booking offer persistence failed");
    if (result.data === null) return null;
    return publicOffer(object(result.data));
  }

  async selectByTokenHash(input: SelectPublicBookingOfferRecord): Promise<void> {
    const result = await this.data.selectPublic({
      p_token_hash: normalizePublicBookingOfferHash(input.tokenHash),
      p_option_selector: normalizePublicBookingOptionSelector(input.selector),
      p_now: input.nowUtc,
    });
    if (result.error || result.data === null) selectionFailed(result.error);
    const state = object(result.data).state;
    if (state !== "SELECTION_PENDING_CONFIRMATION") publicFailed();
  }
}

export class SupabaseBookingOfferAccessGateway implements BookingOfferAccessDataGateway {
  constructor(private readonly rpc: (name: string, parameters: Record<string, unknown>) => Promise<Result>) {}
  rotateAccess = (parameters: Record<string, unknown>) => this.rpc("rotate_booking_offer_public_access", parameters);
  getPublic = (parameters: Record<string, unknown>) => this.rpc("get_public_booking_offer", parameters);
  selectPublic = (parameters: Record<string, unknown>) => this.rpc("select_public_booking_offer", parameters);
}

export function createSupabaseBookingOfferAccessRepository(environment: Record<string, string | undefined>, ownerUserId: string): SupabaseBookingOfferAccessRepository {
  return new SupabaseBookingOfferAccessRepository(createGateway(environment), ownerUserId);
}

export function createSupabasePublicBookingOfferRepository(environment: Record<string, string | undefined>): SupabasePublicBookingOfferRepository {
  return new SupabasePublicBookingOfferRepository(createGateway(environment));
}

export function secureBookingOfferTokenBytes(size: number): Uint8Array {
  return randomBytes(size);
}

export function sha256BookingOfferToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createGateway(environment: Record<string, string | undefined>): SupabaseBookingOfferAccessGateway {
  const url = environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Booking offer access persistence failed");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseBookingOfferAccessGateway(async (name, parameters) => {
    const { data, error } = await client.rpc(name, parameters);
    return { data, error };
  });
}

function publicOffer(row: Record<string, unknown>): PublicBookingOfferView {
  const state = row.state;
  if (state !== "OPEN" && state !== "SELECTION_PENDING_CONFIRMATION") publicFailed();
  const rawOptions = array(row.options);
  if ((state === "OPEN" && (rawOptions.length < 1 || rawOptions.length > 3)) || (state === "SELECTION_PENDING_CONFIRMATION" && rawOptions.length !== 1)) publicFailed();
  const base = {
    expiresAt: timestamp(row.expires_at),
    artistDisplayName: boundedString(row.artist_display_name, 120),
    timeZone: row.time_zone === null ? null : boundedString(row.time_zone, 128),
  };
  if (state === "OPEN") {
    const options = rawOptions.map((value) => {
      const option = publicInterval(value);
      return { ...option, selector: normalizePublicBookingOptionSelector(object(value).selector as string) };
    });
    return { ...base, state, options };
  }
  const options = rawOptions.map((value) => {
    const option = object(value);
    if ("selector" in option) publicFailed();
    return publicInterval(option);
  });
  return { ...base, state, options };
}

function publicInterval(value: unknown): { startUtc: string; endUtc: string } {
  const option = object(value), startUtc = timestamp(option.start_at), endUtc = timestamp(option.end_at);
  if (startUtc >= endUtc) publicFailed();
  return { startUtc, endUtc };
}

function ownerFailed(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "P0002") throw new BookingContextNotFoundError();
  throw new Error("Booking offer access persistence failed");
}


function selectionFailed(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "P0002") throw new PublicBookingOfferUnavailableError();
  if (code === "P0003") throw new PublicBookingOfferSelectionRejectedError();
  throw new Error("Public booking offer persistence failed");
}
function publicFailed(): never { throw new Error("Public booking offer persistence failed"); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) publicFailed(); return value as Record<string, unknown>; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) publicFailed(); return value; }
function boundedString(value: unknown, maxLength: number): string { if (typeof value !== "string" || value.length < 1 || value.length > maxLength) publicFailed(); return value; }
function timestamp(value: unknown): string {
  if (typeof value !== "string") publicFailed();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) publicFailed();
  return date.toISOString();
}
