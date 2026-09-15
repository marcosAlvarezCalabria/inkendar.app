import {
  InvalidPublicBookingOfferTokenError,
  PUBLIC_BOOKING_OFFER_TOKEN_BYTES,
  encodePublicBookingOfferToken,
  normalizeBookingResourceId,
  normalizePublicBookingOfferHash,
  normalizePublicBookingOfferToken,
  type BookingOptionDraft,
} from "@inkendar/domain";

export type RotateBookingOfferAccessRecord = Readonly<{
  studioId: string;
  offerId: string;
  tokenHash: string;
  nowUtc: string;
}>;

export type PublicBookingOfferView = Readonly<{
  expiresAt: string;
  artistDisplayName: string;
  timeZone: string | null;
  options: readonly BookingOptionDraft[];
}>;

export interface BookingOfferAccessRepositoryPort {
  rotateAccess(input: RotateBookingOfferAccessRecord): Promise<Readonly<{ expiresAt: string }>>;
}

export interface PublicBookingOfferRepositoryPort {
  getByTokenHash(input: Readonly<{ tokenHash: string; nowUtc: string }>): Promise<PublicBookingOfferView | null>;
}

export class PublicBookingOfferUnavailableError extends Error {
  readonly code = "PUBLIC_BOOKING_OFFER_UNAVAILABLE";
  constructor() { super("Public booking offer is unavailable"); this.name = "PublicBookingOfferUnavailableError"; }
}

type Dependencies = Readonly<{
  ownerRepository: BookingOfferAccessRepositoryPort;
  publicRepository: PublicBookingOfferRepositoryPort;
  randomBytes(size: number): Uint8Array;
  hashToken(token: string): string;
  clock?: () => Date;
}>;

export function createBookingOfferAccessService(dependencies: Dependencies) {
  const now = () => {
    const value = (dependencies.clock ?? (() => new Date()))();
    if (!Number.isFinite(value.getTime())) throw new Error("Server clock is invalid");
    return value.toISOString();
  };

  return {
    async issue(studioId: string, offerId: string): Promise<Readonly<{ token: string; expiresAt: string }>> {
      const token = encodePublicBookingOfferToken(dependencies.randomBytes(PUBLIC_BOOKING_OFFER_TOKEN_BYTES));
      const tokenHash = normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const result = await dependencies.ownerRepository.rotateAccess({
        studioId: normalizeBookingResourceId(studioId),
        offerId: normalizeBookingResourceId(offerId),
        tokenHash,
        nowUtc: now(),
      });
      return { token, expiresAt: result.expiresAt };
    },

    async getPublic(rawToken: string): Promise<PublicBookingOfferView> {
      let token: string;
      try { token = normalizePublicBookingOfferToken(rawToken); }
      catch (error) {
        if (error instanceof InvalidPublicBookingOfferTokenError) throw new PublicBookingOfferUnavailableError();
        throw error;
      }
      const tokenHash = normalizePublicBookingOfferHash(dependencies.hashToken(token));
      const offer = await dependencies.publicRepository.getByTokenHash({ tokenHash, nowUtc: now() });
      if (!offer) throw new PublicBookingOfferUnavailableError();
      return offer;
    },
  };
}
