import { describe, expect, it, vi } from "vitest";

import {
  loadSupabasePublicConfig,
  serializeSupabaseAuthCookie,
  SupabaseAuthenticationAdapter,
  type SupabaseAuthClient,
} from "./supabase-auth.js";

const userId = "10000000-0000-4000-8000-000000000001";
const studioId = "20000000-0000-4000-8000-000000000001";
const profileId = "30000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000001";
type MembershipTable = "artist_profile" | "membership" | "user_profile";

function client(
  role: "OWNER" | "ARTIST" = "ARTIST",
  failingTable?: MembershipTable,
): SupabaseAuthClient {
  const rows: Record<MembershipTable, ReadonlyArray<Record<string, string>>> = {
    membership: [
      {
        id: membershipId,
        role,
        studio_id: studioId,
        user_id: userId,
        user_profile_id: profileId,
      },
    ],
    user_profile: [
      {
        id: profileId,
        display_name: role === "OWNER" ? "Owner" : "Artist",
        studio_id: studioId,
        user_id: userId,
      },
    ],
    artist_profile:
      role === "ARTIST"
        ? [{ membership_id: membershipId, studio_id: studioId, user_id: userId }]
        : [],
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn((table: MembershipTable) => ({
      select: vi.fn(() => ({
        match: vi.fn(async (filters: Readonly<Record<string, string>>) => ({
          data: rows[table].filter((row) =>
            Object.entries(filters).every(([column, value]) => row[column] === value),
          ),
          error: table === failingTable ? new Error("provider detail must stay private") : null,
        })),
      })),
    })),
  };
}

describe("Supabase authentication adapter", () => {
  it("fails closed when public server configuration is missing", () => {
    expect(() => loadSupabasePublicConfig({ SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used" })).toThrow(
      "Missing server environment: SUPABASE_URL",
    );
  });

  it("uses Auth and maps an artist through explicit tenant-scoped reads", async () => {
    const supabase = client();
    const adapter = new SupabaseAuthenticationAdapter(supabase);

    await expect(adapter.signInWithPassword({ email: "artist@example.com", password: "private-password" })).resolves.toEqual({ userId });
    await expect(adapter.getAuthenticatedUser()).resolves.toEqual({ userId });
    await expect(adapter.findForUser(userId)).resolves.toEqual([
      {
        membership: { id: membershipId, role: "ARTIST", studioId, userId },
        userProfile: { id: profileId, displayName: "Artist", studioId, userId },
        artistProfile: { membershipId, studioId, userId },
      },
    ]);
    await adapter.signOut();

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(supabase.from).toHaveBeenNthCalledWith(1, "membership");
    expect(supabase.from).toHaveBeenNthCalledWith(2, "user_profile");
    expect(supabase.from).toHaveBeenNthCalledWith(3, "artist_profile");
  });

  it("maps an owner without an artist profile through the same tenant-scoped reads", async () => {
    const adapter = new SupabaseAuthenticationAdapter(client("OWNER"));

    await expect(adapter.findForUser(userId)).resolves.toEqual([
      {
        membership: { id: membershipId, role: "OWNER", studioId, userId },
        userProfile: { id: profileId, displayName: "Owner", studioId, userId },
        artistProfile: null,
      },
    ]);
  });

  it("sanitizes profile lookup failures", async () => {
    const adapter = new SupabaseAuthenticationAdapter(client("ARTIST", "user_profile"));

    const error = await adapter.findForUser(userId).catch((caught: unknown) => caught);

    expect(String(error)).toBe("Error: Supabase membership lookup failed");
    expect(String(error)).not.toContain("provider detail");
  });

  it("does not expose provider errors or submitted secrets", async () => {
    const supabase = client();
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: null },
      error: new Error("artist@example.com private-password rejected"),
    });
    const adapter = new SupabaseAuthenticationAdapter(supabase);

    const error = await adapter
      .signInWithPassword({ email: "artist@example.com", password: "private-password" })
      .catch((caught: unknown) => caught);

    expect(String(error)).toBe("Error: Supabase authentication operation failed");
  });

  it("forces server-only auth cookie attributes in production while preserving expiry", () => {
    const serialized = serializeSupabaseAuthCookie(
      "sb-session",
      "secret-token",
      { httpOnly: false, maxAge: 0, path: "/unsafe", sameSite: "none", secure: false },
      { NODE_ENV: "production" },
    );

    expect(serialized).toContain("Max-Age=0");
    expect(serialized).toContain("Path=/");
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("Secure");
    expect(serialized).toContain("SameSite=Lax");
    expect(serialized).not.toContain("Path=/unsafe");
  });

  it("keeps auth cookies usable over local HTTP", () => {
    const serialized = serializeSupabaseAuthCookie(
      "sb-session",
      "secret-token",
      { maxAge: 60 },
      { NODE_ENV: "test" },
    );

    expect(serialized).toContain("Path=/");
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("SameSite=Lax");
    expect(serialized).not.toContain("Secure");
  });
});
