import { describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@inkendar/domain";

import {
  SupabaseAccessSuspensionRepository,
  type AccessSuspensionDataGateway,
} from "./supabase-access-suspension.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000002";

function gateway(): AccessSuspensionDataGateway {
  return {
    listMembers: vi.fn(async () => ({
      data: [{ id: membershipId, role: "ARTIST", status: "ACTIVE", user_profile: { display_name: "Artist" } }],
      error: null,
    })),
    setArtistStatus: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase artist access repository", () => {
  it("projects only display fields from tenant-scoped membership rows", async () => {
    const data = gateway();
    const members = await new SupabaseAccessSuspensionRepository(data).listMembers(studioId);
    expect(data.listMembers).toHaveBeenCalledWith(studioId);
    expect(members).toEqual([{ id: membershipId, displayName: "Artist", role: "ARTIST", status: "ACTIVE" }]);
  });

  it("calls the identity-bound mutation with only target ID and status", async () => {
    const data = gateway();
    await new SupabaseAccessSuspensionRepository(data).setArtistStatus(membershipId, "SUSPENDED");
    expect(data.setArtistStatus).toHaveBeenCalledWith(membershipId, "SUSPENDED");
  });

  it("fails closed and sanitizes provider errors and malformed rows", async () => {
    const data = gateway();
    vi.mocked(data.listMembers).mockResolvedValueOnce({ data: [], error: new Error("private provider details") });
    await expect(new SupabaseAccessSuspensionRepository(data).listMembers(studioId)).rejects.toThrow("Artist access persistence failed");
    vi.mocked(data.listMembers).mockResolvedValueOnce({
      data: [{ id: membershipId, role: "ARTIST", status: "UNKNOWN", user_profile: { display_name: "Artist" } }],
      error: null,
    });
    await expect(new SupabaseAccessSuspensionRepository(data).listMembers(studioId)).rejects.toThrow("Artist access persistence failed");
    vi.mocked(data.setArtistStatus).mockResolvedValueOnce({ data: null, error: new Error("private provider details") });
    await expect(new SupabaseAccessSuspensionRepository(data).setArtistStatus(membershipId, "ACTIVE")).rejects.toThrow("Artist access persistence failed");
  });

  it("maps a denied RPC target to a generic access error", async () => {
    const data = gateway();
    vi.mocked(data.setArtistStatus).mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "private tenant details" },
    });
    await expect(new SupabaseAccessSuspensionRepository(data).setArtistStatus(membershipId, "SUSPENDED")).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
