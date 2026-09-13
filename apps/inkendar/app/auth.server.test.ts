import { describe, expect, it, vi } from "vitest";

import { AccessDeniedError, type AuthorizedAccess } from "@inkendar/domain";
import type { createAuthenticationService } from "@inkendar/application";

import { createAuthHandlers, safeReturnPath, type AuthRequestContext } from "./auth.server.js";

const owner: AuthorizedAccess = {
  displayName: "Owner",
  role: "OWNER",
  studioId: "20000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
};

function context(access: AuthorizedAccess | null = owner): AuthRequestContext {
  return {
    headers: new Headers({ "Set-Cookie": "session=rotated; HttpOnly", "Cache-Control": "private, no-store" }),
    service: {
      currentAccess: vi.fn(async () => access),
      login: vi.fn(async () => owner),
      logout: vi.fn(async () => undefined),
    } as ReturnType<typeof createAuthenticationService>,
  };
}

describe("PWA auth request handlers", () => {
  it.each(["https://evil.example", "//evil.example/path", "javascript:alert(1)", "/login", "/other"])(
    "rejects unsafe return path %s",
    (value) => expect(safeReturnPath(value, "OWNER")).toBe("/app/owner"),
  );

  it("preserves a private internal path for the authorized role", () => {
    expect(safeReturnPath("/app/owner?view=today", "OWNER")).toBe("/app/owner?view=today");
    expect(safeReturnPath("/app/artist", "OWNER")).toBe("/app/owner");
  });

  it("redirects an anonymous private request to login with a safe return path", async () => {
    const anonymous = context(null);
    const handlers = createAuthHandlers(() => anonymous);

    const response = await handlers.requireRole(new Request("https://app.inkendar.es/app/owner?view=today"), "OWNER");

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/login?returnTo=%2Fapp%2Fowner%3Fview%3Dtoday");
    expect((response as Response).headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("denies a mismatched role without serializing tenant data", async () => {
    const handlers = createAuthHandlers(() => context(owner));
    const caught = await handlers
      .requireRole(new Request("https://app.inkendar.es/app/artist"), "ARTIST")
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
    expect(await (caught as Response).text()).not.toContain(owner.studioId);
  });

  it("returns a generic login error and keeps private responses uncached", async () => {
    const requestContext = context();
    vi.mocked(requestContext.service.login).mockRejectedValueOnce(new Error("provider details"));
    const handlers = createAuthHandlers(() => requestContext);
    const form = new FormData();
    form.set("email", "owner@example.com");
    form.set("password", "private-password");

    const response = await handlers.login(new Request("https://app.inkendar.es/login", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No se pudo iniciar sesión con esas credenciales." });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("invalidates the local session and returns to login", async () => {
    const requestContext = context();
    const handlers = createAuthHandlers(() => requestContext);

    const response = await handlers.logout(new Request("https://app.inkendar.es/logout", { method: "POST" }));

    expect(requestContext.service.logout).toHaveBeenCalledOnce();
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
  });

  it("turns incoherent authenticated access into a data-free 403", async () => {
    const requestContext = context();
    vi.mocked(requestContext.service.currentAccess).mockRejectedValueOnce(new AccessDeniedError());
    const handlers = createAuthHandlers(() => requestContext);

    const caught = await handlers
      .requireRole(new Request("https://app.inkendar.es/app/owner"), "OWNER")
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });
});
