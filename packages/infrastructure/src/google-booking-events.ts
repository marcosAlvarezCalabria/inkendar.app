import { createHash } from "node:crypto";

import {
  BookingConfirmationCredentialInvalidError,
  BookingConfirmationProviderUnavailableError,
  type BookingCalendarEvent,
  type BookingEventIdentity,
  type BookingEventIdentityPort,
  type GoogleBookingEventPort,
} from "@inkendar/application";
import type { GoogleCalendarConfig } from "./google-calendar.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";
const EVENT_ID = /^[a-v0-9]{5,1024}$/u;
const CORRELATION = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RESPONSE_BYTES = 1_000_000;
const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

export class NodeBookingEventIdentity implements BookingEventIdentityPort {
  create(optionId: string): BookingEventIdentity {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(optionId)) fail();
    const eventDigest = createHash("sha256").update(`inkendar:google-event:v1:${optionId}`, "utf8").digest();
    const correlation = createHash("sha256").update(`inkendar:google-correlation:v1:${optionId}`, "utf8").digest("base64url");
    return { eventId: `inkendar${base32hex(eventDigest)}`, correlation };
  }
}

export class GoogleBookingEventHttpAdapter implements GoogleBookingEventPort {
  constructor(private readonly config: GoogleCalendarConfig, private readonly fetcher: Fetcher = fetch) {}

  async getEvent(refreshToken: string, input: Readonly<{ calendarId: string; eventId: string }>): Promise<BookingCalendarEvent | null> {
    validateIdentityInput(input.calendarId, input.eventId);
    const accessToken = await this.accessToken(refreshToken);
    const url = eventUrl(input.calendarId, input.eventId);
    url.searchParams.set("fields", "id,status,summary,transparency,visibility,start(dateTime),end(dateTime),extendedProperties/private,attendees");
    const response = await request(this.fetcher, url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) { await discard(response); return null; }
    return event(await json(response));
  }

  async insertEvent(refreshToken: string, input: Readonly<{ calendarId: string; eventId: string; correlation: string; startUtc: string; endUtc: string; summary: string }>): Promise<BookingCalendarEvent> {
    validateIdentityInput(input.calendarId, input.eventId);
    if (!CORRELATION.test(input.correlation) || input.summary !== "Cita Inkendar") fail();
    const startUtc = utc(input.startUtc), endUtc = utc(input.endUtc);
    if (endUtc <= startUtc) fail();
    const accessToken = await this.accessToken(refreshToken);
    const url = new URL(`${EVENTS_ENDPOINT}/${encodeURIComponent(input.calendarId)}/events`);
    url.searchParams.set("fields", "id,status,summary,transparency,visibility,start(dateTime),end(dateTime),extendedProperties/private,attendees");
    const response = await request(this.fetcher, url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: input.eventId, summary: input.summary, status: "confirmed", transparency: "opaque", visibility: "private", start: { dateTime: input.startUtc }, end: { dateTime: input.endUtc }, extendedProperties: { private: { inkendar_booking: input.correlation } } }),
      signal: AbortSignal.timeout(8_000),
    });
    return event(await json(response));
  }

  private async accessToken(refreshToken: string): Promise<string> {
    if (!refreshToken || refreshToken.length > 8192) fail();
    const response = await request(this.fetcher, TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await json(response, true);
    return required(payload.access_token);
  }
}

function event(value: Record<string, unknown>): BookingCalendarEvent {
  const start = record(value.start), end = record(value.end), extended = record(value.extendedProperties), properties = record(extended.private);
  const attendees = value.attendees === undefined ? [] : value.attendees;
  if (!Array.isArray(attendees)) fail();
  const status = value.status, transparency = value.transparency ?? "opaque", visibility = value.visibility;
  if (status !== "confirmed" && status !== "tentative" && status !== "cancelled") fail();
  if (transparency !== "opaque" && transparency !== "transparent") fail();
  if (visibility !== "private" && visibility !== "default" && visibility !== "public" && visibility !== "confidential") fail();
  return { id: required(value.id), status, summary: required(value.summary), transparency, visibility, startUtc: iso(required(start.dateTime)), endUtc: iso(required(end.dateTime)), correlation: nullable(properties.inkendar_booking), attendeeCount: attendees.length };
}

function eventUrl(calendarId: string, eventId: string): URL { return new URL(`${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events/${eventId}`); }
function validateIdentityInput(calendarId: string, eventId: string): void {
  if (!calendarId || calendarId.length > 1024 || Array.from(calendarId).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || !EVENT_ID.test(eventId)) fail();
}
async function request(fetcher: Fetcher, input: string | URL, init: RequestInit): Promise<Response> { try { return await fetcher(input, init); } catch { fail(); } }
async function discard(response: Response): Promise<void> { try { await response.text(); } catch { /* a 404 is sufficient evidence */ } }
async function json(response: Response, refresh = false): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail();
  let value: unknown;
  try { value = await response.json(); } catch { fail(); }
  const payload = record(value);
  if (!response.ok) {
    if (refresh && payload.error === "invalid_grant") throw new BookingConfirmationCredentialInvalidError();
    fail();
  }
  return payload;
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(); return value as Record<string, unknown>; }
function required(value: unknown): string { if (typeof value !== "string" || !value) fail(); return value; }
function nullable(value: unknown): string | null { return value === undefined || value === null ? null : required(value); }
function iso(value: string): string { const parsed = utc(value); return new Date(parsed).toISOString(); }
function utc(value: string): number { const parsed = new Date(value); if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(parsed.getTime())) fail(); return parsed.getTime(); }
function base32hex(value: Uint8Array): string { let buffer = 0, bits = 0, result = ""; for (const byte of value) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += BASE32HEX[(buffer >>> bits) & 31]; buffer &= (1 << bits) - 1; } } if (bits > 0) result += BASE32HEX[(buffer << (5 - bits)) & 31]; return result; }
function fail(): never { throw new BookingConfirmationProviderUnavailableError(); }
