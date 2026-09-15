import { describe, expect, it, vi } from "vitest";
import { BookingConfirmationCredentialInvalidError, BookingConfirmationProviderUnavailableError } from "@inkendar/application";
import { GoogleBookingEventHttpAdapter, NodeBookingEventIdentity } from "./google-booking-events.js";

const config = { clientId: "client", clientSecret: "secret", redirectUri: "https://app.inkendar.es/auth/google/callback" };
const interval = { startUtc: "2026-09-20T09:00:00.000Z", endUtc: "2026-09-20T10:00:00.000Z" };
const input = { calendarId: "artist+inkendar@example.test", eventId: "inkendar0123456789abcdefghijklmnopqrstuv", correlation: "C".repeat(43), ...interval, summary: "Cita Inkendar" };
const responseEvent = { id: input.eventId, status: "confirmed", summary: input.summary, transparency: "opaque", visibility: "private", start: { dateTime: interval.startUtc }, end: { dateTime: interval.endUtc }, extendedProperties: { private: { inkendar_booking: input.correlation } } };

describe("Google booking event identity", () => {
  it("derives stable separated opaque identities without embedding the option UUID", () => {
    const identity = new NodeBookingEventIdentity();
    const first = identity.create("91000000-0000-4000-8000-000000000001");
    expect(first.eventId).toMatch(/^[a-v0-9]{5,1024}$/u);
    expect(first.correlation).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(identity.create("91000000-0000-4000-8000-000000000001")).toEqual(first);
    expect(identity.create("91000000-0000-4000-8000-000000000002")).not.toEqual(first);
    expect(JSON.stringify(first)).not.toContain("91000000");
  });
});

describe("Google booking event adapter", () => {
  it("gets the deterministic ID first and maps only the confirmation contract", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "access" })).mockResolvedValueOnce(Response.json(responseEvent));
    const result = await new GoogleBookingEventHttpAdapter(config, fetcher).getEvent("refresh", { calendarId: input.calendarId, eventId: input.eventId });
    expect(result).toEqual({ id: input.eventId, status: "confirmed", summary: input.summary, transparency: "opaque", visibility: "private", ...interval, correlation: input.correlation, attendeeCount: 0 });
    expect(String(fetcher.mock.calls[1]![0])).toContain(`/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`);
    expect(fetcher.mock.calls[1]![1]?.method).toBe("GET");
  });

  it("distinguishes an exact event 404 from all other provider failures", async () => {
    const missing = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "access" })).mockResolvedValueOnce(Response.json({ error: { code: 404 } }, { status: 404 }));
    await expect(new GoogleBookingEventHttpAdapter(config, missing).getEvent("refresh", { calendarId: input.calendarId, eventId: input.eventId })).resolves.toBeNull();
    const invalid = vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(new GoogleBookingEventHttpAdapter(config, invalid).getEvent("refresh", { calendarId: input.calendarId, eventId: input.eventId })).rejects.toBeInstanceOf(BookingConfirmationCredentialInvalidError);
  });

  it("inserts one private opaque event with no attendees, PII, description or recurrence", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "access" })).mockResolvedValueOnce(Response.json(responseEvent));
    await new GoogleBookingEventHttpAdapter(config, fetcher).insertEvent("refresh", input);
    const request = fetcher.mock.calls[1]![1]!;
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({ id: input.eventId, summary: "Cita Inkendar", status: "confirmed", transparency: "opaque", visibility: "private", start: { dateTime: interval.startUtc }, end: { dateTime: interval.endUtc }, extendedProperties: { private: { inkendar_booking: input.correlation } } });
    expect(String(request.body)).not.toMatch(/attendee|customer|case|description|recurrence/iu);
  });

  it("fails closed before or after HTTP on malformed input and response payloads", async () => {
    const before = vi.fn();
    await expect(new GoogleBookingEventHttpAdapter(config, before).getEvent("refresh", { calendarId: "", eventId: input.eventId })).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
    expect(before).not.toHaveBeenCalled();
    const after = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "access" })).mockResolvedValueOnce(Response.json({ ...responseEvent, attendees: {} }));
    await expect(new GoogleBookingEventHttpAdapter(config, after).getEvent("refresh", { calendarId: input.calendarId, eventId: input.eventId })).rejects.toBeInstanceOf(BookingConfirmationProviderUnavailableError);
  });
});
