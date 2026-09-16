import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  BookingNotificationEmailRejectedError,
  BookingNotificationEmailUnavailableError,
} from "@inkendar/application";

import {
  InvalidSmtpBookingNotificationConfigurationError,
  createSmtpBookingNotificationProviderFactory,
} from "./smtp-booking-notifications.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const secret = "synthetic-smtp-password";
const serialized = JSON.stringify([{
  studioId,
  host: "smtp.example.test",
  port: 465,
  secure: true,
  from: "notifications@example.test",
  user: "smtp-user@example.test",
  pass: secret,
}]);

describe("SMTP booking notification adapter", () => {
  it("treats missing configuration as no route for every studio", () => {
    const factory = createSmtpBookingNotificationProviderFactory(undefined, vi.fn());
    expect(factory(studioId)).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify([{ studioId, host: "", port: 465, secure: true, from: "notifications@example.test", user: "user", pass: secret }]),
    JSON.stringify([{ studioId, host: "smtp.example.test", port: 0, secure: true, from: "notifications@example.test", user: "user", pass: secret }]),
    JSON.stringify([{ studioId, host: "smtp.example.test", port: 465, secure: "true", from: "notifications@example.test", user: "user", pass: secret }]),
    JSON.stringify([{ studioId, host: "smtp.example.test", port: 465, secure: true, from: "not-an-email", user: "user", pass: secret }]),
    JSON.stringify([{ studioId, host: "smtp.example.test", port: 465, secure: true, from: "notifications@example.test", user: "", pass: secret }]),
    JSON.stringify([{ studioId, host: "smtp.example.test", port: 465, secure: true, from: "notifications@example.test", user: "user", pass: "" }]),
  ])("rejects malformed server-only configuration without exposing values %#", (value) => {
    expect(() => createSmtpBookingNotificationProviderFactory(value, vi.fn())).toThrowError(
      expect.objectContaining({ code: "INVALID_SMTP_BOOKING_NOTIFICATION_CONFIGURATION" }),
    );
    try {
      createSmtpBookingNotificationProviderFactory(value, vi.fn());
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSmtpBookingNotificationConfigurationError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("smtp-user");
    }
  });

  it("uses authenticated TLS SMTP and returns only a hashed non-sensitive message id", async () => {
    const sendMail = vi.fn(async () => ({
      accepted: ["client@example.test"],
      rejected: [],
      messageId: "<provider-sensitive-id@example.test>",
    }));
    const transportFactory = vi.fn(() => ({ sendMail }));
    const provider = createSmtpBookingNotificationProviderFactory(serialized, transportFactory)(studioId);
    expect(provider).not.toBeNull();

    await expect(provider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      AbortSignal.timeout(1_000),
    )).resolves.toEqual({
      externalMessageId: `smtp_${createHash("sha256").update("<provider-sensitive-id@example.test>").digest("base64url")}`,
    });

    expect(transportFactory).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "smtp-user@example.test", pass: secret },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 8_000,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "notifications@example.test",
      to: "client@example.test",
      subject: "Cita confirmada",
      text: "Tu cita está confirmada.",
    });
  });

  it("requires STARTTLS when secure is false", () => {
    const transportFactory = vi.fn(() => ({ sendMail: vi.fn() }));
    const startTls = JSON.stringify([{
      studioId,
      host: "smtp.example.test",
      port: 587,
      secure: false,
      from: "notifications@example.test",
      user: "smtp-user@example.test",
      pass: secret,
    }]);
    expect(createSmtpBookingNotificationProviderFactory(startTls, transportFactory)(studioId)).not.toBeNull();
    expect(transportFactory).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));
  });

  it("classifies an SMTP response rejection as confirmed and hides provider details", async () => {
    const provider = createSmtpBookingNotificationProviderFactory(serialized, () => ({
      sendMail: vi.fn(async () => {
        const error = new Error(`550 rejected ${secret}`) as Error & { responseCode: number };
        error.responseCode = 550;
        throw error;
      }),
    }))(studioId);
    await expect(provider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      AbortSignal.timeout(1_000),
    )).rejects.toBeInstanceOf(BookingNotificationEmailRejectedError);
    await provider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      AbortSignal.timeout(1_000),
    ).catch((error: unknown) => expect(String(error)).not.toContain(secret));
  });

  it("classifies network and malformed success outcomes as ambiguous", async () => {
    const networkProvider = createSmtpBookingNotificationProviderFactory(serialized, () => ({
      sendMail: vi.fn(async () => { throw new Error("ECONNRESET"); }),
    }))(studioId);
    await expect(networkProvider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      AbortSignal.timeout(1_000),
    )).rejects.toBeInstanceOf(BookingNotificationEmailUnavailableError);

    const malformedProvider = createSmtpBookingNotificationProviderFactory(serialized, () => ({
      sendMail: vi.fn(async () => ({ accepted: ["client@example.test"], rejected: [], messageId: "" })),
    }))(studioId);
    await expect(malformedProvider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      AbortSignal.timeout(1_000),
    )).rejects.toBeInstanceOf(BookingNotificationEmailUnavailableError);
  });

  it("closes the SMTP transport and returns an ambiguous outcome on timeout", async () => {
    const close = vi.fn();
    const provider = createSmtpBookingNotificationProviderFactory(serialized, () => ({
      sendMail: vi.fn(() => new Promise<never>(() => undefined)),
      close,
    }))(studioId);
    const controller = new AbortController();
    const result = provider?.send(
      { to: "client@example.test", subject: "Cita confirmada", text: "Tu cita está confirmada." },
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(BookingNotificationEmailUnavailableError);
    expect(close).toHaveBeenCalledOnce();
  });
});
