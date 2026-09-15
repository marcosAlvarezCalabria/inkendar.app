import {
  InvalidPublicBookingOfferTokenError,
  isBookingIntervalFree,
  normalizeBookingConfirmationInterval,
  normalizePublicBookingOfferHash,
  normalizePublicBookingOfferToken,
  type BookingConfirmationInterval,
} from "@inkendar/domain";
import { AvailabilityCredentialInvalidError, AvailabilityProviderUnavailableError, GOOGLE_FREE_BUSY_SCOPE, type GoogleFreeBusyPort } from "./availability.js";
import type { GoogleConnectionStatus, GoogleTokenProtectorPort } from "./google-calendar.js";
import { PublicBookingOfferUnavailableError } from "./booking-offer-access.js";

export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const BOOKING_EVENT_SUMMARY = "Cita Inkendar";

export type BookingEventIdentity = Readonly<{ eventId: string; correlation: string }>;
export interface BookingEventIdentityPort { create(optionId: string): BookingEventIdentity; }

export type BookingCalendarEvent = BookingConfirmationInterval & Readonly<{
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary: string;
  transparency: "opaque" | "transparent";
  visibility: "private" | "default" | "public" | "confidential";
  correlation: string | null;
  attendeeCount: number;
}>;

export interface GoogleBookingEventPort {
  getEvent(refreshToken: string, input: Readonly<{ calendarId: string; eventId: string }>): Promise<BookingCalendarEvent | null>;
  insertEvent(refreshToken: string, input: Readonly<{ calendarId: string; eventId: string; correlation: string; startUtc: string; endUtc: string; summary: string }>): Promise<BookingCalendarEvent>;
}

export type BookingConfirmationConnection = Readonly<{
  id: string;
  status: GoogleConnectionStatus;
  encryptedRefreshToken: string | null;
  grantedScopes: readonly string[];
  credentialGeneration: number;
}>;

export type BookingConfirmationContext = BookingConfirmationInterval & Readonly<{
  state: "PENDING" | "CONFIRMED";
  studioId: string;
  optionId: string;
  calendarId: string | null;
  connection: BookingConfirmationConnection | null;
  finalized: (BookingEventIdentity & Readonly<{ confirmedAt: string }>) | null;
}>;

export type BookingConfirmationClaim =
  | Readonly<{ kind: "BUSY" }>
  | Readonly<{ kind: "RECONNECT_REQUIRED" }>
  | (BookingConfirmationInterval & BookingEventIdentity & Readonly<{
      kind: "CLAIMED";
      mode: "INSERT_OR_RECONCILE" | "RECONCILE_ONLY";
      leaseId: string;
      studioId: string;
      optionId: string;
      calendarId: string;
      connection: BookingConfirmationConnection;
      finalized: (BookingEventIdentity & Readonly<{ confirmedAt: string }>) | null;
    }>);

export interface BookingConfirmationRepositoryPort {
  getContext(input: Readonly<{ tokenHash: string; nowUtc: string }>): Promise<BookingConfirmationContext | null>;
  claim(input: Readonly<{ tokenHash: string; eventId: string; correlation: string; nowUtc: string }>): Promise<BookingConfirmationClaim | null>;
  beginInsert(input: Readonly<{ tokenHash: string; leaseId: string; nowUtc: string }>): Promise<boolean>;
  releaseClaim(input: Readonly<{ tokenHash: string; leaseId: string; nowUtc: string }>): Promise<void>;
  resetInsert(input: Readonly<{ tokenHash: string; leaseId: string; nowUtc: string }>): Promise<void>;
  finalize(input: Readonly<{ tokenHash: string; leaseId: string; connectionId: string; calendarId: string; eventId: string; correlation: string; nowUtc: string }>): Promise<Readonly<{ confirmedAt: string }>>;
  markReauthRequired(studioId: string, connectionId: string, credentialGeneration: number): Promise<void>;
}

export class BookingConfirmationConflictError extends Error { readonly code = "BOOKING_CONFIRMATION_CONFLICT"; }
export class BookingConfirmationMismatchError extends Error { readonly code = "BOOKING_CONFIRMATION_MISMATCH"; }
export class BookingConfirmationProviderUnavailableError extends Error { readonly code = "BOOKING_CONFIRMATION_PROVIDER_UNAVAILABLE"; }
export class BookingConfirmationReconnectRequiredError extends Error { readonly code = "BOOKING_CONFIRMATION_RECONNECT_REQUIRED"; }
export class BookingConfirmationCredentialInvalidError extends Error { readonly code = "BOOKING_CONFIRMATION_CREDENTIAL_INVALID"; }

type Dependencies = Readonly<{
  repository: BookingConfirmationRepositoryPort;
  events: GoogleBookingEventPort;
  freeBusy: GoogleFreeBusyPort;
  tokens: GoogleTokenProtectorPort;
  identity: BookingEventIdentityPort;
  hashToken(token: string): string;
  clock?: () => Date;
}>;

export function createBookingConfirmationService(dependencies: Dependencies) {
  return {
    async confirmPublic(rawToken: string): Promise<Readonly<{ state: "CONFIRMED"; confirmedAt: string }>> {
      const nowUtc = now(dependencies.clock);
      const tokenHash = publicTokenHash(rawToken, dependencies.hashToken);
      const preparation = await dependencies.repository.getContext({ tokenHash, nowUtc });
      if (!preparation) throw new PublicBookingOfferUnavailableError();
      const proposedIdentity = dependencies.identity.create(preparation.optionId);
      const claim = await dependencies.repository.claim({ tokenHash, ...proposedIdentity, nowUtc });
      if (!claim) throw new PublicBookingOfferUnavailableError();
      if (claim.kind === "BUSY") throw new BookingConfirmationProviderUnavailableError();
      if (claim.kind === "RECONNECT_REQUIRED") throw new BookingConfirmationReconnectRequiredError();
      const selected = normalizeBookingConfirmationInterval(claim);
      if (claim.optionId !== preparation.optionId || claim.eventId !== proposedIdentity.eventId || claim.correlation !== proposedIdentity.correlation) {
        throw new BookingConfirmationMismatchError();
      }
      const connection = claim.connection;
      if (connection.status !== "ACTIVE" || !connection.encryptedRefreshToken
        || !connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE) || !connection.grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE)) {
        throw new BookingConfirmationReconnectRequiredError();
      }
      const refreshToken = dependencies.tokens.decrypt(connection.encryptedRefreshToken);
      const existing = await readEvent(refreshToken, claim, tokenHash, nowUtc, dependencies);
      if (existing) return finalizeMatching(existing, claim, selected, tokenHash, nowUtc, dependencies.repository);
      if (claim.mode === "RECONCILE_ONLY" || claim.finalized) throw new BookingConfirmationMismatchError();

      let busy;
      try {
        busy = await dependencies.freeBusy.queryBusy(refreshToken, { calendarId: claim.calendarId, timeMin: selected.startUtc, timeMax: selected.endUtc });
      } catch (error) {
        await dependencies.repository.releaseClaim({ tokenHash, leaseId: claim.leaseId, nowUtc });
        if (error instanceof AvailabilityCredentialInvalidError) {
          await dependencies.repository.markReauthRequired(claim.studioId, connection.id, connection.credentialGeneration);
          throw new BookingConfirmationReconnectRequiredError();
        }
        if (error instanceof AvailabilityProviderUnavailableError) throw new BookingConfirmationProviderUnavailableError();
        throw error;
      }
      if (!isBookingIntervalFree(selected, busy)) {
        await dependencies.repository.releaseClaim({ tokenHash, leaseId: claim.leaseId, nowUtc });
        throw new BookingConfirmationConflictError();
      }
      if (!await dependencies.repository.beginInsert({ tokenHash, leaseId: claim.leaseId, nowUtc })) {
        throw new BookingConfirmationProviderUnavailableError();
      }

      let inserted: BookingCalendarEvent;
      try {
        inserted = await dependencies.events.insertEvent(refreshToken, { calendarId: claim.calendarId, eventId: claim.eventId, correlation: claim.correlation, ...selected, summary: BOOKING_EVENT_SUMMARY });
      } catch (error) {
        if (error instanceof BookingConfirmationCredentialInvalidError) {
          await dependencies.repository.resetInsert({ tokenHash, leaseId: claim.leaseId, nowUtc });
          await dependencies.repository.markReauthRequired(claim.studioId, connection.id, connection.credentialGeneration);
          throw new BookingConfirmationReconnectRequiredError();
        }
        const reconciled = await readEvent(refreshToken, claim, tokenHash, nowUtc, dependencies);
        if (!reconciled) throw new BookingConfirmationProviderUnavailableError();
        return finalizeMatching(reconciled, claim, selected, tokenHash, nowUtc, dependencies.repository);
      }
      return finalizeMatching(inserted, claim, selected, tokenHash, nowUtc, dependencies.repository);
    },
  };
}

async function readEvent(refreshToken: string, claim: Extract<BookingConfirmationClaim, { kind: "CLAIMED" }>, tokenHash: string, nowUtc: string, dependencies: Dependencies): Promise<BookingCalendarEvent | null> {
  try { return await dependencies.events.getEvent(refreshToken, { calendarId: claim.calendarId, eventId: claim.eventId }); }
  catch (error) {
    if (error instanceof BookingConfirmationCredentialInvalidError) {
      await dependencies.repository.releaseClaim({ tokenHash, leaseId: claim.leaseId, nowUtc });
      await dependencies.repository.markReauthRequired(claim.studioId, claim.connection.id, claim.connection.credentialGeneration);
      throw new BookingConfirmationReconnectRequiredError();
    }
    if (error instanceof BookingConfirmationProviderUnavailableError) throw error;
    throw new BookingConfirmationProviderUnavailableError();
  }
}

async function finalizeMatching(event: BookingCalendarEvent, claim: Extract<BookingConfirmationClaim, { kind: "CLAIMED" }>, selected: BookingConfirmationInterval, tokenHash: string, nowUtc: string, repository: BookingConfirmationRepositoryPort) {
  const storedIdentityMatches = !claim.finalized || (claim.finalized.eventId === claim.eventId && claim.finalized.correlation === claim.correlation);
  if (!storedIdentityMatches || event.id !== claim.eventId || event.startUtc !== selected.startUtc || event.endUtc !== selected.endUtc
    || event.status !== "confirmed" || event.summary !== BOOKING_EVENT_SUMMARY || event.transparency !== "opaque" || event.visibility !== "private"
    || event.correlation !== claim.correlation || event.attendeeCount !== 0) throw new BookingConfirmationMismatchError();
  const result = await repository.finalize({ tokenHash, leaseId: claim.leaseId, connectionId: claim.connection.id, calendarId: claim.calendarId, eventId: claim.eventId, correlation: claim.correlation, nowUtc });
  return { state: "CONFIRMED" as const, confirmedAt: result.confirmedAt };
}

function publicTokenHash(rawToken: string, hashToken: (token: string) => string): string {
  try { return normalizePublicBookingOfferHash(hashToken(normalizePublicBookingOfferToken(rawToken))); }
  catch (error) { if (error instanceof InvalidPublicBookingOfferTokenError) throw new PublicBookingOfferUnavailableError(); throw error; }
}

function now(clock: (() => Date) | undefined): string {
  const value = (clock ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) throw new BookingConfirmationProviderUnavailableError();
  return value.toISOString();
}
