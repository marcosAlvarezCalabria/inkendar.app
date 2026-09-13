import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authHandlers } from "../../../apps/inkendar/app/auth.server.js";

const enabled = process.env.INKENDAR_AUTH_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("Supabase Auth SSR integration", () => {
  const userId = randomUUID();
  const studioId = randomUUID();
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const email = `auth-smoke-${userId}@example.test`;
  const password = "local-auth-smoke-password";
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "integration-disabled";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "integration-disabled";
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  beforeAll(async () => {
    required("SUPABASE_URL");
    required("SUPABASE_ANON_KEY");
    required("SUPABASE_SERVICE_ROLE_KEY");
    const created = await admin.auth.admin.createUser({ id: userId, email, password, email_confirm: true });
    if (created.error) throw created.error;
    const studio = await admin.from("studio").insert({ id: studioId, name: "Auth Smoke Studio" });
    if (studio.error) throw studio.error;
    const profile = await admin.from("user_profile").insert({
      id: profileId,
      studio_id: studioId,
      user_id: userId,
      display_name: "Auth Smoke Owner",
    });
    if (profile.error) throw profile.error;
    const membership = await admin.from("membership").insert({
      id: membershipId,
      studio_id: studioId,
      user_id: userId,
      user_profile_id: profileId,
      role: "OWNER",
    });
    if (membership.error) throw membership.error;
  });

  afterAll(async () => {
    await admin.from("studio").delete().eq("id", studioId);
    await admin.auth.admin.deleteUser(userId);
  });

  it("logs in with real Auth, guards through RLS cookies, and logs out", async () => {
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_ANON_KEY = anonKey;
    const jar = new Map<string, string>();
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    const login = await authHandlers.login(
      new Request("http://127.0.0.1:3000/login", { method: "POST", body: form }),
    );

    expect(login.status).toBe(302);
    expect(login.headers.get("Location")).toBe("/app/owner");
    applyCookies(jar, login.headers);

    const guarded = await authHandlers.requireRole(
      new Request("http://127.0.0.1:3000/app/owner", { headers: { Cookie: cookieHeader(jar) } }),
      "OWNER",
    );
    expect(guarded).toMatchObject({ role: "OWNER", studioId, userId });

    const logout = await authHandlers.logout(
      new Request("http://127.0.0.1:3000/logout", {
        method: "POST",
        headers: { Cookie: cookieHeader(jar) },
      }),
    );
    expect(logout.headers.get("Location")).toBe("/login");
    applyCookies(jar, logout.headers);

    const afterLogout = await authHandlers.requireRole(
      new Request("http://127.0.0.1:3000/app/owner", { headers: { Cookie: cookieHeader(jar) } }),
      "OWNER",
    );
    expect(afterLogout).toBeInstanceOf(Response);
    expect((afterLogout as Response).headers.get("Location")).toContain("/login?returnTo=");
  });
});

function applyCookies(jar: Map<string, string>, headers: Headers): void {
  for (const header of headers.getSetCookie()) {
    const [pair] = header.split(";", 1);
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator < 1) continue;
    const [name, value] = [pair.slice(0, separator), pair.slice(separator + 1)];
    if (!value || /max-age=0/i.test(header)) jar.delete(name); else jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration environment: ${name}`);
  return value;
}
