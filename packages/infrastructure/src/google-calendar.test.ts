import { describe, expect, it, vi } from "vitest";

import {
  AesGcmGoogleTokenProtector,
  GoogleCalendarHttpAdapter,
  NodeGoogleOAuthSecurity,
  loadGoogleCalendarConfig,
} from "./google-calendar.js";

const config = {
  clientId: "synthetic-client.apps.googleusercontent.com",
  clientSecret: "synthetic-client-secret",
  redirectUri: "http://127.0.0.1:3000/auth/google/callback",
};
const scope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

describe("Google Calendar infrastructure", () => {
  it("loads exact server configuration and rejects an unregistered redirect", () => {
    expect(loadGoogleCalendarConfig({
      GOOGLE_OAUTH_CLIENT_ID: config.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: config.redirectUri,
    })).toEqual(config);
    expect(() => loadGoogleCalendarConfig({
      GOOGLE_OAUTH_CLIENT_ID: config.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: "https://evil.example/auth/google/callback",
    })).toThrow("Invalid GOOGLE_OAUTH_REDIRECT_URI");
  });

  it("creates an authorization URL with only the CalendarList scope and fixed security parameters", () => {
    const adapter = new GoogleCalendarHttpAdapter(config, vi.fn());
    const url = new URL(adapter.createAuthorizationUrl("synthetic-state-value-with-sufficient-entropy"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe(scope);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("openid")).toBe(false);
  });

  it("exchanges an authorization code only at the server token endpoint", async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => { void input; void init; return new Response(JSON.stringify({ refresh_token: "refresh-secret", scope }), { status: 200, headers: { "Content-Type": "application/json" } }); });
    const adapter = new GoogleCalendarHttpAdapter(config, fetcher);
    await expect(adapter.exchangeCode("synthetic-code")).resolves.toEqual({ refreshToken: "refresh-secret", grantedScopes: [scope] });
    expect(fetcher).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.objectContaining({ method: "POST" }));
    const body = vi.mocked(fetcher).mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("client_secret")).toBe(config.clientSecret);
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("refreshes server-side and lists only minimal calendar metadata across pages", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-lived-access" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "one@example.test", summary: "One", description: "must not escape", timeZone: "Europe/Madrid", accessRole: "owner", primary: true }], nextPageToken: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "two@example.test", summaryOverride: "Two", accessRole: "writer" }] }), { status: 200 }));
    const adapter = new GoogleCalendarHttpAdapter(config, fetcher);

    const calendars = await adapter.listCalendars("refresh-secret");

    expect(calendars).toEqual([
      { id: "one@example.test", summary: "One", timeZone: "Europe/Madrid", accessRole: "owner", primary: true },
      { id: "two@example.test", summary: "Two", timeZone: null, accessRole: "writer", primary: false },
    ]);
    const firstListUrl = new URL(vi.mocked(fetcher).mock.calls[1]?.[0] as string);
    expect(firstListUrl.searchParams.get("fields")).toBe("items(id,summary,summaryOverride,timeZone,accessRole,primary),nextPageToken");
    expect(firstListUrl.searchParams.has("singleEvents")).toBe(false);
    expect(JSON.stringify(calendars)).not.toContain("description");
  });

  it("encrypts refresh tokens with randomized AES-256-GCM and rejects tampering", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const protector = new AesGcmGoogleTokenProtector(key);
    const first = protector.encrypt("refresh-secret");
    const second = protector.encrypt("refresh-secret");
    expect(first).not.toBe(second);
    expect(protector.decrypt(first)).toBe("refresh-secret");
    const tampered = `${first.slice(0, -1)}${first.endsWith("A") ? "B" : "A"}`;
    expect(() => protector.decrypt(tampered)).toThrow("Google token decryption failed");
  });

  it("generates unpredictable state and hashes it without persistence of the raw value", () => {
    const security = new NodeGoogleOAuthSecurity();
    const first = security.createState();
    const second = security.createState();
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).not.toBe(second);
    expect(security.hashState(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(security.hashState(first)).not.toContain(first);
  });
});
