import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseAuthRequestAdapter } from "./supabase-auth.js";
import { authHandlers } from "../../../apps/inkendar/app/auth.server.js";

const enabled = process.env.INKENDAR_AUTH_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

type RoleFixture = Readonly<{
  email: string;
  membershipId: string;
  password: string;
  profileId: string;
  role: "OWNER" | "ARTIST";
  studioId: string;
  userId: string;
}>;

type PendingRoleFixture = Omit<RoleFixture, "userId">;

suite("Supabase Auth SSR integration", () => {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "integration-disabled";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "integration-disabled";
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it("covers both roles, tenant RLS, crossed guards, cookie flags, and logout", async () => {
    required("SUPABASE_URL");
    required("SUPABASE_ANON_KEY");
    required("SUPABASE_SERVICE_ROLE_KEY");
    const pendingOwner = fixture("OWNER");
    const pendingArtist = fixture("ARTIST");
    const createdUsers: string[] = [];
    const createdStudios: string[] = [];
    let cleanupFailure: unknown;
    let testFailure: unknown;

    try {
      await verifyPublicEmailSignupDenied(admin, pendingOwner);
      const owner = await provision(admin, pendingOwner, createdUsers, createdStudios);
      const artist = await provision(admin, pendingArtist, createdUsers, createdStudios);
      process.env.SUPABASE_URL = url;
      process.env.SUPABASE_ANON_KEY = anonKey;

      await verifyTenantRls(owner, artist);
      await verifyTenantRls(artist, owner);
      await verifyRequestAdapter(owner);
      await verifyRequestAdapter(artist);
      await verifyRoleFlow(owner, "ARTIST");
      await verifyRoleFlow(artist, "OWNER");
    } catch (error: unknown) {
      testFailure = error;
    } finally {
      try {
        await cleanup(admin, createdStudios, createdUsers);
      } catch (error: unknown) {
        cleanupFailure = error;
      }
    }

    if (testFailure && cleanupFailure) {
      throw new AggregateError([testFailure, cleanupFailure], "Auth smoke and cleanup both failed", {
        cause: testFailure,
      });
    }
    if (cleanupFailure) throw cleanupFailure;
    if (testFailure) throw testFailure;
  });

  async function verifyPublicEmailSignupDenied(
    adminClient: SupabaseClient,
    pendingIdentity: PendingRoleFixture,
  ): Promise<void> {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let signedUp;
    try {
      signedUp = await client.auth.signUp({
        email: pendingIdentity.email,
        password: pendingIdentity.password,
      });
    } catch {
      throw new Error("Auth smoke: public email signup request failed");
    }

    const unexpectedUserId = signedUp.data.user?.id;
    if (unexpectedUserId) {
      const deleted = await adminClient.auth.admin.deleteUser(unexpectedUserId);
      if (deleted.error) throw new Error("Auth smoke: unexpected public signup cleanup failed");
    }
    if (!signedUp.error || authErrorCategory(signedUp.error) !== "signup-disabled") {
      throw new Error("Auth smoke: public email signup was not rejected");
    }
  }

  async function verifyTenantRls(identity: RoleFixture, otherTenant: RoleFixture): Promise<void> {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let signedIn;
    try {
      signedIn = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
    } catch {
      throw new Error(`Auth smoke ${identity.role}: direct sign-in request failed`);
    }
    if (signedIn.error) {
      throw new Error(`Auth smoke ${identity.role}: direct sign-in was rejected (${authErrorCategory(signedIn.error)})`);
    }
    if (!signedIn.data.session) {
      throw new Error(`Auth smoke ${identity.role}: direct sign-in returned no session`);
    }
    if (signedIn.data.user?.id !== identity.userId) {
      throw new Error(`Auth smoke ${identity.role}: direct sign-in returned another identity`);
    }

    const memberships = await client.from("membership").select("studio_id,user_id");
    if (memberships.error) {
      throw new Error(`Auth smoke ${identity.role}: direct membership RLS query failed`);
    }
    expect(memberships.data).toEqual([{ studio_id: identity.studioId, user_id: identity.userId }]);
    expect(memberships.data).not.toContainEqual({ studio_id: otherTenant.studioId, user_id: otherTenant.userId });

    const studios = await client.from("studio").select("id");
    if (studios.error) {
      throw new Error(`Auth smoke ${identity.role}: direct studio RLS query failed`);
    }
    expect(studios.data).toEqual(identity.role === "OWNER" ? [{ id: identity.studioId }] : []);
    expect(studios.data).not.toContainEqual({ id: otherTenant.studioId });
  }

  async function verifyRequestAdapter(identity: RoleFixture): Promise<void> {
    const { adapter } = createSupabaseAuthRequestAdapter(
      new Request("http://127.0.0.1:3000/login"),
      { NODE_ENV: "test", SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey },
    );
    let authenticated;
    try {
      authenticated = await adapter.signInWithPassword({ email: identity.email, password: identity.password });
    } catch {
      throw new Error(`Auth smoke ${identity.role}: request adapter sign-in failed`);
    }
    expect(authenticated).toEqual({ userId: identity.userId });

    let records;
    try {
      records = await adapter.findForUser(identity.userId);
    } catch {
      throw new Error(`Auth smoke ${identity.role}: request adapter membership lookup failed`);
    }
    expect(records).toHaveLength(1);
    expect(records[0]?.membership).toMatchObject({
      role: identity.role,
      studioId: identity.studioId,
      userId: identity.userId,
    });
  }
});

function fixture(role: "OWNER" | "ARTIST"): PendingRoleFixture {
  const fixtureId = randomUUID();
  return {
    email: `auth-smoke-${role.toLowerCase()}-${fixtureId}@example.com`,
    membershipId: randomUUID(),
    password: "local-auth-smoke-password",
    profileId: randomUUID(),
    role,
    studioId: randomUUID(),
  };
}

async function provision(
  admin: SupabaseClient,
  pendingIdentity: PendingRoleFixture,
  createdUsers: string[],
  createdStudios: string[],
): Promise<RoleFixture> {
  const created = await admin.auth.admin.createUser({
    email: pendingIdentity.email,
    password: pendingIdentity.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user?.id) {
    throw new Error(`Auth smoke ${pendingIdentity.role}: admin createUser failed`);
  }
  const identity = { ...pendingIdentity, userId: created.data.user.id };
  createdUsers.push(identity.userId);

  const studio = await admin.from("studio").insert({ id: identity.studioId, name: `Auth Smoke ${identity.role}` });
  if (studio.error) throw studio.error;
  createdStudios.push(identity.studioId);

  const profile = await admin.from("user_profile").insert({
    id: identity.profileId,
    studio_id: identity.studioId,
    user_id: identity.userId,
    display_name: `Auth Smoke ${identity.role}`,
  });
  if (profile.error) throw profile.error;
  const membership = await admin.from("membership").insert({
    id: identity.membershipId,
    studio_id: identity.studioId,
    user_id: identity.userId,
    user_profile_id: identity.profileId,
    role: identity.role,
  });
  if (membership.error) throw membership.error;

  if (identity.role === "ARTIST") {
    const artist = await admin.from("artist_profile").insert({
      studio_id: identity.studioId,
      membership_id: identity.membershipId,
      user_id: identity.userId,
      display_name: "Auth Smoke ARTIST",
    });
    if (artist.error) throw artist.error;
  }
  return identity;
}

async function verifyRoleFlow(identity: RoleFixture, deniedRole: "OWNER" | "ARTIST"): Promise<void> {
  const origin = "http://127.0.0.1:3000";
  const jar = new Map<string, string>();
  const form = new FormData();
  form.set("email", identity.email);
  form.set("password", identity.password);
  const login = await authHandlers.login(
    new Request(`${origin}/login`, { method: "POST", headers: mutationHeaders(origin), body: form }),
  );

  expect(login.status).toBe(302);
  expect(login.headers.get("Location")).toBe(identity.role === "OWNER" ? "/app/owner" : "/app/artist");
  expectSecureCookieAttributes(login.headers, false);
  applyCookies(jar, login.headers);

  const guarded = await authHandlers.requireRole(
    new Request(`${origin}/app/${identity.role.toLowerCase()}`, { headers: { Cookie: cookieHeader(jar) } }),
    identity.role,
  );
  expect(guarded).toMatchObject({
    access: { role: identity.role, studioId: identity.studioId, userId: identity.userId },
  });

  const crossed = await authHandlers
    .requireRole(
      new Request(`${origin}/app/${deniedRole.toLowerCase()}`, { headers: { Cookie: cookieHeader(jar) } }),
      deniedRole,
    )
    .catch((error: unknown) => error);
  expect(crossed).toBeInstanceOf(Response);
  expect((crossed as Response).status).toBe(403);

  const logout = await authHandlers.logout(
    new Request(`${origin}/logout`, {
      method: "POST",
      headers: { ...mutationHeaders(origin), Cookie: cookieHeader(jar) },
    }),
  );
  expect(logout.headers.get("Location")).toBe("/login");
  expectSecureCookieAttributes(logout.headers, false);
  applyCookies(jar, logout.headers);

  const afterLogout = await authHandlers.requireRole(
    new Request(`${origin}/app/${identity.role.toLowerCase()}`, { headers: { Cookie: cookieHeader(jar) } }),
    identity.role,
  );
  expect(afterLogout).toBeInstanceOf(Response);
  expect((afterLogout as Response).headers.get("Location")).toContain("/login?returnTo=");
}

function expectSecureCookieAttributes(headers: Headers, secure: boolean): void {
  const cookies = headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    if (secure) expect(cookie).toContain("Secure"); else expect(cookie).not.toContain("Secure");
  }
}

function mutationHeaders(origin: string): Record<string, string> {
  return { Origin: origin, "Sec-Fetch-Site": "same-origin" };
}

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

async function cleanup(admin: SupabaseClient, studioIds: string[], userIds: string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const studioId of studioIds.reverse()) {
    const deleted = await admin.from("studio").delete().eq("id", studioId);
    if (deleted.error) failures.push(deleted.error);
  }
  for (const userId of userIds.reverse()) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(deleted.error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Auth smoke cleanup failed");
}

function authErrorCategory(error: { code?: string | undefined; message: string }): string {
  const value = `${error.code ?? ""} ${error.message}`.toLowerCase();
  const categories: ReadonlyArray<readonly [string, string]> = [
    ["invalid credential", "invalid-credentials"],
    ["email not confirmed", "email-unconfirmed"],
    ["email address is invalid", "email-invalid"],
    ["email provider", "email-provider-disabled"],
    ["signup", "signup-disabled"],
    ["rate limit", "rate-limited"],
    ["database error", "database-error"],
    ["unexpected_failure", "unexpected-failure"],
  ];
  return categories.find(([pattern]) => value.includes(pattern))?.[1] ?? "unclassified";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration environment: ${name}`);
  return value;
}
