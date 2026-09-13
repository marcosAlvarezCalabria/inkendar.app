import { describe, expect, it, vi } from "vitest";

import { DuplicateIdentityError, PersistenceOutcomeUnknownError, StudioNotFoundError } from "@inkendar/application";

import { SupabaseManualOnboardingAdapter } from "./supabase-manual-onboarding.js";

const serviceRoleKey = "test-service-role-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SupabaseManualOnboardingAdapter", () => {
  it("creates a confirmed Auth user with server credentials", async () => {
    const request = vi.fn(async () => jsonResponse({ id: "10000000-0000-4000-8000-000000000001" }));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "http://127.0.0.1:54321/",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.createConfirmedUser({ email: "owner@example.com", password: "private-password" }),
    ).resolves.toEqual({ userId: "10000000-0000-4000-8000-000000000001" });

    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/auth/v1/admin/users",
      expect.objectContaining({
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "private-password",
          email_confirm: true,
        }),
      }),
    );
  });

  it("maps a duplicate Auth response without exposing provider details", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ message: "A user with this email address has already been registered" }, 422),
    );
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    const failure = adapter.createConfirmedUser({
      email: "owner@example.com",
      password: "private-password",
    });

    await expect(failure).rejects.toBeInstanceOf(DuplicateIdentityError);
    await expect(failure).rejects.not.toThrow(/owner@example|private-password/i);
  });

  it("calls the transactional owner RPC without accepting a role parameter", async () => {
    const request = vi.fn(async (input: string, init?: RequestInit) =>
      jsonResponse([
        {
          studio_id: "20000000-0000-4000-8000-000000000001",
          user_profile_id: "30000000-0000-4000-8000-000000000001",
          membership_id: "40000000-0000-4000-8000-000000000001",
        },
      ], input.length > 0 && init !== undefined ? 200 : 500),
    );
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.createStudioOwner({
        displayName: "Owner",
        role: "OWNER",
        studioName: "North Ink",
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({ studioId: "20000000-0000-4000-8000-000000000001" });

    const options = vi.mocked(request).mock.calls[0]?.[1];
    expect(options).toBeDefined();
    expect(JSON.parse(String(options?.body))).toEqual({
      p_display_name: "Owner",
      p_studio_name: "North Ink",
      p_user_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("converges on the committed owner result when the first RPC response is lost", async () => {
    const committed = {
      studio_id: "20000000-0000-4000-8000-000000000001",
      user_profile_id: "30000000-0000-4000-8000-000000000001",
      membership_id: "40000000-0000-4000-8000-000000000001",
    };
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("response lost after commit"))
      .mockResolvedValueOnce(jsonResponse([committed]));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.createStudioOwner({
        displayName: "Owner",
        role: "OWNER",
        studioName: "North Ink",
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toEqual({
      studioId: committed.studio_id,
      userProfileId: committed.user_profile_id,
      membershipId: committed.membership_id,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]?.body).toBe(request.mock.calls[0]?.[1]?.body);
  });

  it("converges on the committed artist result when the first RPC response is lost", async () => {
    const committed = {
      user_profile_id: "30000000-0000-4000-8000-000000000002",
      membership_id: "40000000-0000-4000-8000-000000000002",
      artist_profile_id: "50000000-0000-4000-8000-000000000002",
    };
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("response lost after commit"))
      .mockResolvedValueOnce(jsonResponse([committed]));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.addArtist({
        displayName: "Artist",
        role: "ARTIST",
        studioId: "20000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toEqual({
      userProfileId: committed.user_profile_id,
      membershipId: committed.membership_id,
      artistProfileId: committed.artist_profile_id,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports an ambiguous persistence result after two lost RPC responses", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("response lost after commit");
    });
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.createStudioOwner({
        displayName: "Owner",
        role: "OWNER",
        studioName: "North Ink",
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toBeInstanceOf(PersistenceOutcomeUnknownError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous result when a lost response is followed by an unclassified rejection", async () => {
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("response lost after commit"))
      .mockResolvedValueOnce(jsonResponse({ code: "P0001", message: "UNCLASSIFIED_FAILURE" }, 400));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.createStudioOwner({
        displayName: "Owner",
        role: "OWNER",
        studioName: "North Ink",
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toBeInstanceOf(PersistenceOutcomeUnknownError);
  });

  it("maps a missing studio from the artist RPC to a typed error", async () => {
    const request = vi.fn(async () => jsonResponse({ code: "P0001", message: "STUDIO_NOT_FOUND" }, 400));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await expect(
      adapter.addArtist({
        displayName: "Artist",
        role: "ARTIST",
        studioId: "20000000-0000-4000-8000-000000000099",
        userId: "10000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toBeInstanceOf(StudioNotFoundError);
  });

  it("deletes an Auth user through the Admin API", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    const adapter = new SupabaseManualOnboardingAdapter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey,
      fetch: request,
    });

    await adapter.deleteUser("10000000-0000-4000-8000-000000000001");

    expect(request).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/admin/users/10000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
