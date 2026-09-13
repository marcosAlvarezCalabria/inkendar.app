import { describe, expect, it } from "vitest";

import { AccessDeniedError, resolveAccess, type IdentityAccessRecord } from "./access.js";

const userId = "10000000-0000-4000-8000-000000000001";
const studioId = "20000000-0000-4000-8000-000000000001";

function record(role: "OWNER" | "ARTIST"): IdentityAccessRecord {
  return {
    membership: { id: "40000000-0000-4000-8000-000000000001", role, studioId, userId },
    userProfile: {
      id: "30000000-0000-4000-8000-000000000001",
      displayName: "María",
      studioId,
      userId,
    },
    artistProfile:
      role === "ARTIST"
        ? { membershipId: "40000000-0000-4000-8000-000000000001", studioId, userId }
        : null,
  };
}

describe("identity access", () => {
  it.each(["OWNER", "ARTIST"] as const)("resolves one coherent %s membership", (role) => {
    expect(resolveAccess(userId, [record(role)])).toEqual({
      displayName: "María",
      role,
      studioId,
      userId,
    });
  });

  it.each([
    ["no membership", []],
    ["several memberships", [record("OWNER"), record("ARTIST")]],
    ["another identity", [{ ...record("OWNER"), membership: { ...record("OWNER").membership, userId: "other" } }]],
    [
      "cross-tenant profile",
      [{ ...record("OWNER"), userProfile: { ...record("OWNER").userProfile, studioId: "another-studio" } }],
    ],
    ["artist without artist profile", [{ ...record("ARTIST"), artistProfile: null }]],
  ])("denies %s without returning tenant data", (_case, records) => {
    expect(() => resolveAccess(userId, records as IdentityAccessRecord[])).toThrow(AccessDeniedError);
  });
});
