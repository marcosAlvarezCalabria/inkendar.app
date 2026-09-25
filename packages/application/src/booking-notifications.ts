import { normalizeCustomerEmail, normalizeExternalConversationId, normalizeResourceId } from "@inkendar/domain";

import {
  ConversationNotFoundError,
  ConversationProviderRejectedError,
  type ConversationProviderPort,
} from "./conversations.js";

export type BookingNotificationEventType = "CONFIRMED" | "EXPIRED" | "REJECTED";
export type BookingNotificationRoute =
  | Readonly<{ kind: "CHATWOOT"; externalAccountId: string; externalConversationId: string }>
  | Readonly<{ kind: "EMAIL"; recipient: string }>;
export type BookingNotificationClaim =
  | Readonly<{ kind: "EMPTY" }>
  | Readonly<{ kind: "NO_ROUTE"; jobId: string }>
  | Readonly<{ kind: "UNKNOWN"; jobId: string }>
  | Readonly<{
      kind: "CLAIMED";
      jobId: string;
      leaseId: string;
      studioId: string;
      eventType: BookingNotificationEventType;
      attemptCount: number;
      route: BookingNotificationRoute;
    }>;

export interface BookingNotificationRepositoryPort {
  materializeExpirations(nowUtc: string, limit: number): Promise<number>;
  claimNext(nowUtc: string, leaseExpiresAt: string): Promise<BookingNotificationClaim>;
  markSucceeded(jobId: string, leaseId: string, externalMessageId: string, nowUtc: string): Promise<void>;
  markFailed(jobId: string, leaseId: string, nextAttemptAt: string, nowUtc: string): Promise<void>;
  markUnknown(jobId: string, leaseId: string, nowUtc: string): Promise<void>;
  markNoRoute(jobId: string, leaseId: string, nowUtc: string): Promise<void>;
}

export interface BookingNotificationEmailPort {
  send(
    message: Readonly<{ to: string; subject: string; text: string }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ externalMessageId: string }>>;
}

export class BookingNotificationEmailRejectedError extends Error {
  readonly code = "BOOKING_NOTIFICATION_EMAIL_REJECTED";
  constructor() { super("Booking notification email was rejected"); this.name = "BookingNotificationEmailRejectedError"; }
}

export class BookingNotificationEmailUnavailableError extends Error {
  readonly code = "BOOKING_NOTIFICATION_EMAIL_UNAVAILABLE";
  constructor() { super("Booking notification email outcome is unavailable"); this.name = "BookingNotificationEmailUnavailableError"; }
}

export class InvalidBookingNotificationInputError extends Error {
  readonly code = "INVALID_BOOKING_NOTIFICATION_INPUT";
  constructor() { super("Booking notification input is invalid"); this.name = "InvalidBookingNotificationInputError"; }
}

export type BookingNotificationRunSummary = Readonly<{
  expired: number;
  claimed: number;
  sent: number;
  failed: number;
  unknown: number;
  noRoute: number;
}>;

type Route = Readonly<{ studioId: string; externalAccountId: string; externalConversationId: string }>;
type RunnerDependencies = Readonly<{
  repository: BookingNotificationRepositoryPort;
  providerFor(route: Route): ConversationProviderPort;
  emailProviderFor(studioId: string): BookingNotificationEmailPort | null;
  clock?: () => Date;
  monotonicClock?: () => number;
}>;

export function createBookingNotificationRunner(dependencies: RunnerDependencies) {
  const wallClock = dependencies.clock ?? (() => new Date());
  const monotonicClock = dependencies.monotonicClock ?? (() => performance.now());

  return {
    async run(options: Readonly<{ batchSize: number; leaseSeconds: number; timeBudgetMs: number }>): Promise<BookingNotificationRunSummary> {
      validateOptions(options);
      const deadline = monotonicClock() + options.timeBudgetMs;
      const initialNow = validNow(wallClock());
      const summary = { expired: await dependencies.repository.materializeExpirations(initialNow.toISOString(), options.batchSize), claimed: 0, sent: 0, failed: 0, unknown: 0, noRoute: 0 };

      for (let processed = 0; processed < options.batchSize && monotonicClock() < deadline; processed += 1) {
        const current = validNow(wallClock());
        const claim = await dependencies.repository.claimNext(current.toISOString(), new Date(current.getTime() + options.leaseSeconds * 1_000).toISOString());
        if (claim.kind === "EMPTY") break;
        if (claim.kind === "NO_ROUTE") { summary.noRoute += 1; continue; }
        if (claim.kind === "UNKNOWN") { summary.unknown += 1; continue; }

        summary.claimed += 1;
        let externalMessageId: string;
        if (claim.route.kind === "CHATWOOT") {
          const route = {
            studioId: normalizeResourceId("id", claim.studioId),
            externalAccountId: normalizeExternalConversationId(claim.route.externalAccountId),
            externalConversationId: normalizeExternalConversationId(claim.route.externalConversationId),
          };
          let provider: ConversationProviderPort;
          try {
            provider = dependencies.providerFor(route);
          } catch {
            await dependencies.repository.markFailed(claim.jobId, claim.leaseId, retryAt(current, claim.attemptCount), current.toISOString());
            summary.failed += 1;
            continue;
          }
          try {
            const remaining = Math.max(1, Math.min(8_000, Math.trunc(deadline - monotonicClock())));
            const result = await provider.sendReply(route.externalConversationId, chatwootMessageFor(claim.eventType), AbortSignal.timeout(remaining));
            externalMessageId = normalizeExternalConversationId(result.externalMessageId);
          } catch (error) {
            if (error instanceof ConversationProviderRejectedError || error instanceof ConversationNotFoundError) {
              await dependencies.repository.markFailed(claim.jobId, claim.leaseId, retryAt(current, claim.attemptCount), current.toISOString());
              summary.failed += 1;
            } else {
              await bestEffortUnknown(dependencies.repository, claim.jobId, claim.leaseId, current.toISOString());
              summary.unknown += 1;
            }
            continue;
          }
        } else {
          const studioId = normalizeResourceId("id", claim.studioId);
          const recipient = normalizeCustomerEmail(claim.route.recipient);
          const provider = dependencies.emailProviderFor(studioId);
          if (!recipient || !provider) {
            await dependencies.repository.markNoRoute(claim.jobId, claim.leaseId, current.toISOString());
            summary.noRoute += 1;
            continue;
          }
          try {
            const remaining = Math.max(1, Math.min(8_000, Math.trunc(deadline - monotonicClock())));
            const result = await provider.send(emailMessageFor(claim.eventType, recipient), AbortSignal.timeout(remaining));
            externalMessageId = normalizeNotificationExternalMessageId(result.externalMessageId);
          } catch (error) {
            if (error instanceof BookingNotificationEmailRejectedError) {
              await dependencies.repository.markFailed(claim.jobId, claim.leaseId, retryAt(current, claim.attemptCount), current.toISOString());
              summary.failed += 1;
            } else {
              await bestEffortUnknown(dependencies.repository, claim.jobId, claim.leaseId, current.toISOString());
              summary.unknown += 1;
            }
            continue;
          }
        }

        try {
          await dependencies.repository.markSucceeded(claim.jobId, claim.leaseId, externalMessageId, current.toISOString());
          summary.sent += 1;
        } catch {
          await bestEffortUnknown(dependencies.repository, claim.jobId, claim.leaseId, current.toISOString());
          summary.unknown += 1;
        }
      }

      return summary;
    },
  };
}

function chatwootMessageFor(eventType: BookingNotificationEventType): string {
  switch (eventType) {
    case "CONFIRMED": return "Tu cita está confirmada. Si necesitas ayuda, responde a esta conversación.";
    case "EXPIRED": return "La propuesta de horarios ha caducado. Responde a esta conversación si quieres que revisemos nuevas opciones.";
    case "REJECTED": return "Tu solicitud de cita no fue aceptada. Responde a esta conversación si quieres que revisemos otras opciones.";
  }
}

function emailMessageFor(eventType: BookingNotificationEventType, recipient: string): Readonly<{ to: string; subject: string; text: string }> {
  switch (eventType) {
    case "CONFIRMED": return { to: recipient, subject: "Cita confirmada", text: "Tu cita está confirmada. Si necesitas ayuda, contacta con el estudio." };
    case "EXPIRED": return { to: recipient, subject: "Propuesta de horarios caducada", text: "La propuesta de horarios ha caducado. Contacta con el estudio si quieres revisar nuevas opciones." };
    case "REJECTED": return {
      to: recipient,
      subject: "Solicitud de cita no aceptada",
      text: "Tu solicitud de cita no fue aceptada. Contacta con el estudio si quieres revisar otras opciones.",
    };
  }
}

function normalizeNotificationExternalMessageId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(normalized)) throw new BookingNotificationEmailUnavailableError();
  return normalized;
}

function retryAt(now: Date, attemptCount: number): string {
  const boundedAttempt = Math.max(1, Math.min(3, attemptCount));
  return new Date(now.getTime() + boundedAttempt * 60_000).toISOString();
}

function validateOptions(options: Readonly<{ batchSize: number; leaseSeconds: number; timeBudgetMs: number }>): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100
    || !Number.isInteger(options.leaseSeconds) || options.leaseSeconds < 10 || options.leaseSeconds > 300
    || !Number.isInteger(options.timeBudgetMs) || options.timeBudgetMs < 1_000 || options.timeBudgetMs > 30_000) {
    throw new InvalidBookingNotificationInputError();
  }
}

function validNow(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new InvalidBookingNotificationInputError();
  return value;
}

async function bestEffortUnknown(repository: BookingNotificationRepositoryPort, jobId: string, leaseId: string, nowUtc: string): Promise<void> {
  try { await repository.markUnknown(jobId, leaseId, nowUtc); } catch { /* An expired LEASED row is conservatively swept to UNKNOWN. */ }
}
