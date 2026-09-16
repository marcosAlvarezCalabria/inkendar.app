import { createHash } from "node:crypto";

import nodemailer from "nodemailer";

import {
  BookingNotificationEmailRejectedError,
  BookingNotificationEmailUnavailableError,
  type BookingNotificationEmailPort,
} from "@inkendar/application";
import { normalizeCustomerEmail, normalizeResourceId } from "@inkendar/domain";

type SmtpConnection = Readonly<{
  studioId: string;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user: string;
  pass: string;
}>;

type SmtpTransportOptions = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: Readonly<{ user: string; pass: string }>;
  tls: Readonly<{ minVersion: "TLSv1.2" }>;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}>;

type SmtpSendResult = Readonly<{
  accepted?: unknown;
  rejected?: unknown;
  messageId?: unknown;
}>;

type SmtpTransport = Readonly<{
  sendMail(message: Readonly<{ from: string; to: string; subject: string; text: string }>): Promise<SmtpSendResult>;
  close?(): void;
}>;

export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransport;

export class InvalidSmtpBookingNotificationConfigurationError extends Error {
  readonly code = "INVALID_SMTP_BOOKING_NOTIFICATION_CONFIGURATION";
  constructor() {
    super("SMTP booking notification configuration is invalid");
    this.name = "InvalidSmtpBookingNotificationConfigurationError";
  }
}

export function createSmtpBookingNotificationProviderFactory(
  serializedConnections: string | undefined,
  transportFactory: SmtpTransportFactory = defaultTransportFactory,
): (studioId: string) => BookingNotificationEmailPort | null {
  const connections = parseConnections(serializedConnections);
  return (studioId) => {
    const normalizedStudioId = resource(studioId);
    const connection = connections.find((item) => item.studioId === normalizedStudioId);
    if (!connection) return null;
    const transport = transportFactory({
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      requireTLS: !connection.secure,
      auth: { user: connection.user, pass: connection.pass },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 8_000,
    });
    return new SmtpBookingNotificationAdapter(connection.from, transport);
  };
}

export class SmtpBookingNotificationAdapter implements BookingNotificationEmailPort {
  constructor(
    private readonly from: string,
    private readonly transport: SmtpTransport,
  ) {}

  async send(
    message: Readonly<{ to: string; subject: string; text: string }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ externalMessageId: string }>> {
    const to = email(message.to);
    if (message.subject.trim() !== message.subject || message.subject.length < 1 || message.subject.length > 200
      || message.text.trim() !== message.text || message.text.length < 1 || message.text.length > 2_000) {
      throw new BookingNotificationEmailUnavailableError();
    }
    try {
      const result = await abortable(
        this.transport.sendMail({ from: this.from, to, subject: message.subject, text: message.text }),
        signal,
        () => this.transport.close?.(),
      );
      if (!Array.isArray(result.accepted) || result.accepted.length < 1
        || !Array.isArray(result.rejected) || result.rejected.length > 0) {
        throw new BookingNotificationEmailRejectedError();
      }
      if (typeof result.messageId !== "string" || result.messageId.length < 1 || result.messageId.length > 2_000) {
        throw new BookingNotificationEmailUnavailableError();
      }
      return {
        externalMessageId: `smtp_${createHash("sha256").update(result.messageId).digest("base64url")}`,
      };
    } catch (error) {
      if (error instanceof BookingNotificationEmailRejectedError
        || error instanceof BookingNotificationEmailUnavailableError) throw error;
      if (confirmedSmtpRejection(error)) throw new BookingNotificationEmailRejectedError();
      throw new BookingNotificationEmailUnavailableError();
    }
  }
}

function parseConnections(serialized: string | undefined): readonly SmtpConnection[] {
  if (serialized === undefined || serialized.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) invalid();
    const connections = parsed.map(connection);
    if (new Set(connections.map((item) => item.studioId)).size !== connections.length) invalid();
    return connections;
  } catch (error) {
    if (error instanceof InvalidSmtpBookingNotificationConfigurationError) throw error;
    invalid();
  }
}

function connection(value: unknown): SmtpConnection {
  const row = object(value);
  const host = string(row.host, 253);
  const port = row.port;
  const secure = row.secure;
  if (!/^(?=.{1,253}$)(?![.-])[A-Za-z0-9.-]+(?<![.-])$/.test(host)
    || typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535
    || typeof secure !== "boolean") invalid();
  return {
    studioId: resource(string(row.studioId, 36)),
    host,
    port,
    secure,
    from: email(string(row.from, 254)),
    user: string(row.user, 320),
    pass: string(row.pass, 1_024),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maximum) invalid();
  return value;
}

function resource(value: string): string {
  try { return normalizeResourceId("id", value); } catch { invalid(); }
}

function email(value: string): string {
  try {
    const normalized = normalizeCustomerEmail(value);
    if (!normalized || normalized !== value.toLowerCase()) invalid();
    return normalized;
  } catch { invalid(); }
}

function confirmedSmtpRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("responseCode" in error)) return false;
  const responseCode = error.responseCode;
  return typeof responseCode === "number" && Number.isInteger(responseCode)
    && responseCode >= 400 && responseCode <= 599;
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  abort: () => void,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    abort();
    throw new BookingNotificationEmailUnavailableError();
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      abort();
      reject(new BookingNotificationEmailUnavailableError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const defaultTransportFactory: SmtpTransportFactory = (options) =>
  nodemailer.createTransport(options) as unknown as SmtpTransport;

function invalid(): never {
  throw new InvalidSmtpBookingNotificationConfigurationError();
}
