import { describe, expect, it, vi } from "vitest";

import {
  BookingNotificationEmailRejectedError,
  BookingNotificationEmailUnavailableError,
  ConversationProviderRejectedError,
  ConversationProviderUnavailableError,
  InvalidBookingNotificationInputError,
  createBookingNotificationRunner,
  type BookingNotificationClaim,
  type BookingNotificationRepositoryPort,
  type BookingNotificationEmailPort,
  type ConversationProviderPort,
} from "./index.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const jobId = "90000000-0000-4000-8000-000000000001";
const leaseId = "91000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-16T10:00:00.000Z");

function chatwootClaimed(eventType: "CONFIRMED" | "EXPIRED" = "CONFIRMED"): BookingNotificationClaim {
  return { kind: "CLAIMED", jobId, leaseId, studioId, eventType, attemptCount: 1, route: { kind: "CHATWOOT", externalAccountId: "3", externalConversationId: "42" } };
}

function emailClaimed(eventType: "CONFIRMED" | "EXPIRED" = "CONFIRMED"): BookingNotificationClaim {
  return { kind: "CLAIMED", jobId, leaseId, studioId, eventType, attemptCount: 1, route: { kind: "EMAIL", recipient: "client@example.test" } };
}

function dependencies(claims: BookingNotificationClaim[] = [chatwootClaimed(), { kind: "EMPTY" }]) {
  const repository: BookingNotificationRepositoryPort = {
    materializeExpirations: vi.fn(async () => 1),
    claimNext: vi.fn(async () => claims.shift() ?? { kind: "EMPTY" as const }),
    markSucceeded: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    markUnknown: vi.fn(async () => undefined),
    markNoRoute: vi.fn(async () => undefined),
  };
  const provider: ConversationProviderPort = {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    sendReply: vi.fn(async () => ({ externalMessageId: "84" })),
  };
  const providerFor = vi.fn(() => provider);
  const emailProvider: BookingNotificationEmailPort = {
    send: vi.fn(async () => ({ externalMessageId: "smtp_abcdefghijklmnopqrstuvwxyz0123456789ABCDE" })),
  };
  const emailProviderFor = vi.fn<(studioId: string) => BookingNotificationEmailPort | null>(() => emailProvider);
  return { repository, provider, providerFor, emailProvider, emailProviderFor };
}

describe("booking notification runner", () => {
  it("materializes expirations before sending a bounded generic confirmation", async () => {
    const deps = dependencies();
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });

    await expect(runner.run({ batchSize: 10, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toEqual({ expired: 1, claimed: 1, sent: 1, failed: 0, unknown: 0, noRoute: 0 });

    expect(deps.repository.materializeExpirations).toHaveBeenCalledWith(now.toISOString(), 10);
    expect(deps.repository.claimNext).toHaveBeenCalledWith(now.toISOString(), "2026-09-16T10:00:30.000Z");
    expect(deps.providerFor).toHaveBeenCalledWith({ studioId, externalAccountId: "3", externalConversationId: "42" });
    expect(deps.provider.sendReply).toHaveBeenCalledWith("42", "Tu cita está confirmada. Si necesitas ayuda, responde a esta conversación.", expect.any(AbortSignal));
    expect(deps.repository.markSucceeded).toHaveBeenCalledWith(jobId, leaseId, "84", now.toISOString());
  });

  it("generates the expiry copy only in memory", async () => {
    const deps = dependencies([chatwootClaimed("EXPIRED"), { kind: "EMPTY" }]);
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 });
    expect(deps.provider.sendReply).toHaveBeenCalledWith("42", "La propuesta de horarios ha caducado. Responde a esta conversación si quieres que revisemos nuevas opciones.", expect.any(AbortSignal));
  });

  it("keeps an explicit no-route result without calling Chatwoot", async () => {
    const deps = dependencies([{ kind: "NO_ROUTE", jobId }, { kind: "EMPTY" }]);
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 10, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ noRoute: 1, sent: 0 });
    expect(deps.providerFor).not.toHaveBeenCalled();
  });

  it("prefers the claimed Chatwoot route without consulting email", async () => {
    const deps = dependencies();
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 });
    expect(deps.provider.sendReply).toHaveBeenCalledOnce();
    expect(deps.emailProviderFor).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it.each([
    ["CONFIRMED", "Cita confirmada", "Tu cita está confirmada. Si necesitas ayuda, contacta con el estudio."],
    ["EXPIRED", "Propuesta de horarios caducada", "La propuesta de horarios ha caducado. Contacta con el estudio si quieres revisar nuevas opciones."],
  ] as const)("sends generic %s email copy only in memory", async (eventType, subject, text) => {
    const deps = dependencies([emailClaimed(eventType), { kind: "EMPTY" }]);
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ sent: 1, failed: 0, unknown: 0, noRoute: 0 });
    expect(deps.providerFor).not.toHaveBeenCalled();
    expect(deps.emailProviderFor).toHaveBeenCalledWith(studioId);
    expect(deps.emailProvider.send).toHaveBeenCalledWith({ to: "client@example.test", subject, text }, expect.any(AbortSignal));
    expect(deps.repository.markSucceeded).toHaveBeenCalledWith(jobId, leaseId, "smtp_abcdefghijklmnopqrstuvwxyz0123456789ABCDE", now.toISOString());
  });

  it("marks an email claim NO_ROUTE when the studio has no SMTP configuration", async () => {
    const deps = dependencies([emailClaimed(), { kind: "EMPTY" }]);
    deps.emailProviderFor.mockReturnValueOnce(null);
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ sent: 0, failed: 0, unknown: 0, noRoute: 1 });
    expect(deps.repository.markNoRoute).toHaveBeenCalledWith(jobId, leaseId, now.toISOString());
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it("retries a confirmed SMTP rejection with bounded backoff", async () => {
    const deps = dependencies([emailClaimed(), { kind: "EMPTY" }]);
    vi.mocked(deps.emailProvider.send).mockRejectedValueOnce(new BookingNotificationEmailRejectedError());
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ failed: 1, unknown: 0 });
    expect(deps.repository.markFailed).toHaveBeenCalledWith(jobId, leaseId, "2026-09-16T10:01:00.000Z", now.toISOString());
  });

  it("marks an ambiguous SMTP outcome UNKNOWN without retry", async () => {
    const deps = dependencies([emailClaimed(), { kind: "EMPTY" }]);
    vi.mocked(deps.emailProvider.send).mockRejectedValueOnce(new BookingNotificationEmailUnavailableError());
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ unknown: 1, failed: 0 });
    expect(deps.repository.markUnknown).toHaveBeenCalledWith(jobId, leaseId, now.toISOString());
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("marks a confirmed email UNKNOWN if persisting success fails", async () => {
    const deps = dependencies([emailClaimed(), { kind: "EMPTY" }]);
    vi.mocked(deps.repository.markSucceeded).mockRejectedValueOnce(new Error("database unavailable"));
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ unknown: 1, sent: 0 });
    expect(deps.repository.markUnknown).toHaveBeenCalledWith(jobId, leaseId, now.toISOString());
  });

  it("retries a confirmed rejection with bounded backoff", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.sendReply).mockRejectedValueOnce(new ConversationProviderRejectedError());
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ failed: 1, unknown: 0 });
    expect(deps.repository.markFailed).toHaveBeenCalledWith(jobId, leaseId, "2026-09-16T10:01:00.000Z", now.toISOString());
    expect(deps.repository.markUnknown).not.toHaveBeenCalled();
  });

  it("marks an ambiguous external result UNKNOWN and never converts it to FAILED", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.sendReply).mockRejectedValueOnce(new ConversationProviderUnavailableError());
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ unknown: 1, failed: 0 });
    expect(deps.repository.markUnknown).toHaveBeenCalledWith(jobId, leaseId, now.toISOString());
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("marks a confirmed send UNKNOWN if persisting success fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.markSucceeded).mockRejectedValueOnce(new Error("database unavailable"));
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run({ batchSize: 1, leaseSeconds: 30, timeBudgetMs: 5_000 })).resolves.toMatchObject({ unknown: 1, sent: 0 });
    expect(deps.repository.markUnknown).toHaveBeenCalledWith(jobId, leaseId, now.toISOString());
  });

  it.each([
    { batchSize: 0, leaseSeconds: 30, timeBudgetMs: 5_000 },
    { batchSize: 101, leaseSeconds: 30, timeBudgetMs: 5_000 },
    { batchSize: 10, leaseSeconds: 9, timeBudgetMs: 5_000 },
    { batchSize: 10, leaseSeconds: 301, timeBudgetMs: 5_000 },
    { batchSize: 10, leaseSeconds: 30, timeBudgetMs: 999 },
    { batchSize: 10, leaseSeconds: 30, timeBudgetMs: 30_001 },
  ])("rejects unbounded runner options %#", async (options) => {
    const deps = dependencies();
    const runner = createBookingNotificationRunner({ ...deps, clock: () => now, monotonicClock: () => 100 });
    await expect(runner.run(options)).rejects.toBeInstanceOf(InvalidBookingNotificationInputError);
    expect(deps.repository.materializeExpirations).not.toHaveBeenCalled();
  });
});
