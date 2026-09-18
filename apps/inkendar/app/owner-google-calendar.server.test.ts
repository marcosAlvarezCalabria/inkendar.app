import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarConnectionUnavailableError } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerGoogleCalendarHandlers, type OwnerGoogleCalendarService } from "./owner-google-calendar.server.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const access: AuthorizedAccess = { displayName: "Owner", role: "OWNER", studioId, userId };
const authorize = async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) });

function service(): OwnerGoogleCalendarService {
  return {
    beginConnection: vi.fn(async () => "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"),
    completeConnection: vi.fn(async () => undefined),
    cancelConnectionAttempt: vi.fn(async () => undefined),
    getManagementView: vi.fn(async () => ({ connectionStatus: "NOT_CONNECTED" as const, calendars: [], artists: [] })),
    assignCalendar: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
}

describe("owner Google Calendar handlers", () => {
  it("does not compose Google or service_role before OWNER authorization", async () => {
    const denied = new Response("Denied", { status: 403 });
    const createService = vi.fn(() => service());
    const handlers = createOwnerGoogleCalendarHandlers({ authorize: async () => denied, createService, now: () => new Date() });
    expect(await handlers.loader(new Request("https://app.inkendar.es/app/owner/calendars"))).toBe(denied);
    expect((await handlers.callback(new Request("https://app.inkendar.es/auth/google/callback?state=x&code=y"))).status).toBe(403);
    expect(createService).not.toHaveBeenCalled();
  });

  it("fails an unauthenticated callback closed without copying code or state into a login redirect", async () => {
    const login = new Response(null, { status: 302, headers: { Location: "/login?returnTo=%2Fauth%2Fgoogle%2Fcallback%3Fcode%3Dsecret" } });
    const createService = vi.fn(() => service());
    const handlers = createOwnerGoogleCalendarHandlers({ authorize: async () => login, createService, now: () => new Date() });
    const response = await handlers.callback(new Request("https://app.inkendar.es/auth/google/callback?state=synthetic-oauth-state-with-at-least-32-chars&code=synthetic-code"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Location")).toBeNull();
    expect(createService).not.toHaveBeenCalled();
  });

  it("returns a private safe 503 for a transient Calendar provider failure", async () => {
    const current = service();
    vi.mocked(current.getManagementView).mockRejectedValueOnce(new GoogleCalendarConnectionUnavailableError());
    const handlers = createOwnerGoogleCalendarHandlers({ authorize, createService: () => current, now: () => new Date() });

    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/calendars"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("provider");
  });

  it("starts OAuth only after authorization and redirects to the provider URL", async () => {
    const current = service();
    const handlers = createOwnerGoogleCalendarHandlers({ authorize, createService: () => current, now: () => new Date("2026-09-14T10:00:00Z") });
    const form = new FormData(); form.set("intent", "connect");
    const response = await handlers.action(mutation(form));
    expect(current.beginConnection).toHaveBeenCalledWith(studioId, userId, new Date("2026-09-14T10:00:00Z"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("https://accounts.google.com/");
  });

  it("rejects cross-origin mutations before authorization or secret composition", async () => {
    const guard = vi.fn(); const createService = vi.fn(() => service());
    const handlers = createOwnerGoogleCalendarHandlers({ authorize: guard, createService, now: () => new Date() });
    const response = await handlers.action(new Request("https://app.inkendar.es/app/owner/calendars", { method: "POST", headers: { Origin: "https://evil.example" }, body: new FormData() }));
    expect(response.status).toBe(403); expect(guard).not.toHaveBeenCalled(); expect(createService).not.toHaveBeenCalled();
  });

  it("validates and consumes state on a controlled Google denial without exchange", async () => {
    const current = service();
    const handlers = createOwnerGoogleCalendarHandlers({ authorize, createService: () => current, now: () => new Date("2026-09-14T10:00:00Z") });
    const response = await handlers.callback(new Request("https://app.inkendar.es/auth/google/callback?state=synthetic-oauth-state-with-at-least-32-chars&error=access_denied"));
    expect(current.cancelConnectionAttempt).toHaveBeenCalledWith(studioId, userId, "synthetic-oauth-state-with-at-least-32-chars", new Date("2026-09-14T10:00:00Z"));
    expect(current.completeConnection).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe("/app/owner/calendars?result=denied");
  });

  it("completes a valid callback and uses only a fixed local result redirect", async () => {
    const current = service();
    const handlers = createOwnerGoogleCalendarHandlers({ authorize, createService: () => current, now: () => new Date("2026-09-14T10:00:00Z") });
    const response = await handlers.callback(new Request("https://app.inkendar.es/auth/google/callback?state=synthetic-oauth-state-with-at-least-32-chars&code=synthetic-code"));
    expect(current.completeConnection).toHaveBeenCalledWith(studioId, userId, "synthetic-oauth-state-with-at-least-32-chars", "synthetic-code", new Date("2026-09-14T10:00:00Z"));
    expect(response.headers.get("Location")).toBe("/app/owner/calendars?result=connected");
  });

  it("assigns or clears one artist calendar from same-origin forms", async () => {
    const current = service();
    const handlers = createOwnerGoogleCalendarHandlers({ authorize, createService: () => current, now: () => new Date() });
    const assignment = new FormData(); assignment.set("intent", "assign"); assignment.set("artistProfileId", "50000000-0000-4000-8000-000000000001"); assignment.set("calendarId", "inkendar-local-artist@example.test");
    const response = await handlers.action(mutation(assignment));
    expect(current.assignCalendar).toHaveBeenCalledWith(
      studioId,
      "50000000-0000-4000-8000-000000000001",
      "inkendar-local-artist@example.test",
    );
    const clearing = new FormData(); clearing.set("intent", "assign"); clearing.set("artistProfileId", "50000000-0000-4000-8000-000000000001"); clearing.set("calendarId", "");
    await handlers.action(mutation(clearing));
    expect(current.assignCalendar).toHaveBeenCalledWith(studioId, "50000000-0000-4000-8000-000000000001", null);
    expect(response.status).toBe(303);
  });
});

function mutation(body: FormData): Request {
  return new Request("https://app.inkendar.es/app/owner/calendars", { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body });
}
