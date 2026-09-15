import { normalizeBookingResourceId, validateBookingExpiryHours, validateBookingOptions, type BookingOptionDraft } from "@inkendar/domain";

export { InvalidBookingOfferInputError } from "@inkendar/domain";

export type BookingOfferStatus = "OPEN" | "SELECTED_PENDING_CONFIRMATION" | "EXPIRED";
export type BookingOptionStatus = "HELD" | "SELECTED" | "RELEASED";
export type BookingOfferOption = BookingOptionDraft & Readonly<{ id: string; status: BookingOptionStatus }>;
export type BookingOffer = Readonly<{ id: string; studioId: string; tattooCaseId: string; artistProfileId: string; status: BookingOfferStatus; expiresAt: string; createdAt: string; options: readonly BookingOfferOption[] }>;
export type BookingOfferCase = Readonly<{ id: string; summary: string; artistProfileId: string | null }>;
export type BookingOfferArtist = Readonly<{ id: string; displayName: string }>;
export type BookingOfferManagement = Readonly<{ expiryHours: number; cases: readonly BookingOfferCase[]; artists: readonly BookingOfferArtist[]; offers: readonly BookingOffer[] }>;
export type CreateBookingOfferRecord = Readonly<{ studioId: string; tattooCaseId: string; artistProfileId: string; options: readonly BookingOptionDraft[]; nowUtc: string }>;

export class BookingContextNotFoundError extends Error { readonly code = "BOOKING_CONTEXT_NOT_FOUND"; }
export class BookingHoldConflictError extends Error { readonly code = "BOOKING_HOLD_CONFLICT"; }

export interface BookingOfferRepositoryPort {
  getManagement(studioId: string): Promise<BookingOfferManagement>;
  saveExpiryHours(studioId: string, expiryHours: number): Promise<void>;
  createOffer(input: CreateBookingOfferRecord): Promise<BookingOffer>;
  expireDue(studioId: string, nowUtc: string): Promise<number>;
}

export function createBookingOfferService(deps: Readonly<{ repository: BookingOfferRepositoryPort; clock?: () => Date }>) {
  const now = () => {
    const value = (deps.clock ?? (() => new Date()))();
    if (!Number.isFinite(value.getTime())) throw new Error("Server clock is invalid");
    return value.toISOString();
  };
  return {
    list: (studioId: string) => deps.repository.getManagement(normalizeBookingResourceId(studioId)),
    async configureExpiry(studioId: string, expiryHours: number): Promise<void> {
      await deps.repository.saveExpiryHours(normalizeBookingResourceId(studioId), validateBookingExpiryHours(expiryHours));
    },
    async create(studioId: string, tattooCaseId: string, artistProfileId: string, options: readonly BookingOptionDraft[]): Promise<BookingOffer> {
      const nowUtc = now();
      return await deps.repository.createOffer({ studioId: normalizeBookingResourceId(studioId), tattooCaseId: normalizeBookingResourceId(tattooCaseId), artistProfileId: normalizeBookingResourceId(artistProfileId), options: validateBookingOptions(options, nowUtc), nowUtc });
    },
    expireDue: (studioId: string) => deps.repository.expireDue(normalizeBookingResourceId(studioId), now()),
  };
}
