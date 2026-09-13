import { describe, expect, it, vi } from "vitest";

import { loadSupabasePublicConfig, SupabaseAuthenticationAdapter, type SupabaseAuthClient } from "./supabase-auth.js";

const userId = "10000000-0000-4000-8000-000000000001";

function client(): SupabaseAuthClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({
          data: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              role: "ARTIST",
              studio_id: "20000000-0000-4000-8000-000000000001",
              user_id: userId,
              user_profile: {
                id: "30000000-0000-4000-8000-000000000001",
                display_name: "Artist",
                studio_id: "20000000-0000-4000-8000-000000000001",
                user_id: userId,
              },
              artist_profile: [
                {
                  membership_id: "40000000-0000-4000-8000-000000000001",
                  studio_id: "20000000-0000-4000-8000-000000000001",
                  user_id: userId,
                },
              ],
            },
          ],
          error: null,
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

  it("uses Auth for the session and maps RLS-scoped membership data", async () => {
    const supabase = client();
    const adapter = new SupabaseAuthenticationAdapter(supabase);

    await expect(adapter.signInWithPassword({ email: "artist@example.com", password: "private-password" })).resolves.toEqual({ userId });
    await expect(adapter.getAuthenticatedUser()).resolves.toEqual({ userId });
    await expect(adapter.findForUser(userId)).resolves.toMatchObject([
      { membership: { role: "ARTIST", studioId: "20000000-0000-4000-8000-000000000001" } },
    ]);
    await adapter.signOut();

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(supabase.from).toHaveBeenCalledWith("membership");
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
});
