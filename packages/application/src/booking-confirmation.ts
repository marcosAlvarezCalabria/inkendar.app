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

export type BookingConfirmationContext = BookingConfirmationInterval & Readonly<{
  state: "PENDING" | "CONFIRMED";
  studioId: string;
  optionId: string;
  calendarId: string | null;
  connection: Readonly<{ id: string; status: GoogleConnectionStatus; encryptedRefreshToken: string | null; grantedScopes: readonly string[] }> | null;
  finalized: (BookingEventIdentity & Readonly<{ confirmedAt: string }>) | null;
}>;

export interface BookingConfirmationRepositoryPort {
  getContext(input: Readonly<{ tokenHash: string; nowUtc: string }>): Promise<BookingConfirmationContext | null>;
  finalize(input: Readonly<{ tokenHash: string; connectionId: string; calendarId: string; eventId: string; correlation: string; nowUtc: string }>): Promise<Readonly<{ confirmedAt: string }>>;
  markReauthRequired(studioId: string, connectionId: string): Promise<void>;
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
      const context = await dependencies.repository.getContext({ tokenHash, nowUtc });
      if (!context) throw new PublicBookingOfferUnavailableError();
      const selected = normalizeBookingConfirmationInterval(context);
      const connection = context.connection;
      if (!context.calendarId || !connection || connection.status !== "ACTIVE" || !connection.encryptedRefreshToken
        || !connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE) || !connection.grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE)) {
        throw new BookingConfirmationReconnectRequiredError();
      }
      const identity = dependencies.identity.create(context.optionId);
      const refreshToken = dependencies.tokens.decrypt(connection.encryptedRefreshToken);
      const existing = await providerCall(() => dependencies.events.getEvent(refreshToken, { calendarId: context.calendarId!, eventId: identity.eventId }), dependencies.repository, context.studioId, connection.id);
      if (existing) return finalizeMatching(existing, context, selected, identity, tokenHash, nowUtc, dependencies.repository);
      if (context.state === "CONFIRMED") throw new BookingConfirmationMismatchError();

      let busy;
      try {
        busy = await dependencies.freeBusy.queryBusy(refreshToken, { calendarId: context.calendarId, timeMin: selected.startUtc, timeMax: selected.endUtc });
      } catch (error) {
        if (error instanceof AvailabilityCredentialInvalidError) {
          await dependencies.repository.markReauthRequired(context.studioId, connection.id);
          throw new BookingConfirmationReconnectRequiredError();
        }
        if (error instanceof AvailabilityProviderUnavailableError) throw new BookingConfirmationProviderUnavailableError();
        throw error;
      }
      if (!isBookingIntervalFree(selected, busy)) throw new BookingConfirmationConflictError();

      let inserted: BookingCalendarEvent;
      try {
        inserted = await dependencies.events.insertEvent(refreshToken, { calendarId: context.calendarId, ...selected, ...identity, summary: BOOKING_EVENT_SUMMARY });
      } catch (error) {
        if (error instanceof BookingConfirmationCredentialInvalidError) {
          await dependencies.repository.markReauthRequired(context.studioId, connection.id);
          throw new BookingConfirmationReconnectRequiredError();
        }
        const reconciled = await providerCall(() => dependencies.events.getEvent(refreshToken, { calendarId: context.calendarId!, eventId: identity.eventId }), dependencies.repository, context.studioId, connection.id);
        if (!reconciled) throw new BookingConfirmationProviderUnavailableError();
        return finalizeMatching(reconciled, context, selected, identity, tokenHash, nowUtc, dependencies.repository);
      }
      return finalizeMatching(inserted, context, selected, identity, tokenHash, nowUtc, dependencies.repository);
    },
  };
}

async function providerCall<T>(operation: () => Promise<T>, repository: BookingConfirmationRepositoryPort, studioId: string, connectionId: string): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof BookingConfirmationCredentialInvalidError) {
      await repository.markReauthRequired(studioId, connectionId);
      throw new BookingConfirmationReconnectRequiredError();
    }
    if (error instanceof BookingConfirmationProviderUnavailableError) throw error;
    throw new BookingConfirmationProviderUnavailableError();
  }
}

async function finalizeMatching(event: BookingCalendarEvent, context: BookingConfirmationContext, selected: BookingConfirmationInterval, identity: BookingEventIdentity, tokenHash: string, nowUtc: string, repository: BookingConfirmationRepositoryPort) {
  const storedIdentityMatches = !context.finalized || (context.finalized.eventId === identity.eventId && context.finalized.correlation === identity.correlation);
  if (!storedIdentityMatches || event.id !== identity.eventId || event.startUtc !== selected.startUtc || event.endUtc !== selected.endUtc
    || event.status !== "confirmed" || event.summary !== BOOKING_EVENT_SUMMARY || event.transparency !== "opaque" || event.visibility !== "private"
    || event.correlation !== identity.correlation || event.attendeeCount !== 0) throw new BookingConfirmationMismatchError();
  const result = await repository.finalize({ tokenHash, connectionId: context.connection!.id, calendarId: context.calendarId!, eventId: identity.eventId, correlation: identity.correlation, nowUtc });
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
