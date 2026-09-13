import { describe, expect, it, vi } from "vitest";

import { AccessDeniedError } from "@inkendar/domain";
import {
  InvalidCredentialsError,
  createAuthenticationService,
  type AuthSessionPort,
  type MembershipAccessPort,
} from "./authentication.js";

const accessRecord = {
  membership: {
    id: "40000000-0000-4000-8000-000000000001",
    role: "OWNER" as const,
    studioId: "20000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000001",
  },
  userProfile: {
    id: "30000000-0000-4000-8000-000000000001",
    displayName: "Owner",
    studioId: "20000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000001",
  },
  artistProfile: null,
};

function ports() {
  const session: AuthSessionPort = {
    getAuthenticatedUser: vi.fn(async () => ({ userId: accessRecord.membership.userId })),
    signInWithPassword: vi.fn(async () => ({ userId: accessRecord.membership.userId })),
    signOut: vi.fn(async () => undefined),
  };
  const memberships: MembershipAccessPort = {
    findForUser: vi.fn(async () => [accessRecord]),
  };
  return { memberships, session };
}

describe("authentication service", () => {
  it("signs in and resolves the only coherent membership", async () => {
    const dependencies = ports();
    const service = createAuthenticationService(dependencies);

    await expect(service.login({ email: "owner@example.com", password: "secret-password" })).resolves.toMatchObject({
      role: "OWNER",
      studioId: accessRecord.membership.studioId,
    });
    expect(dependencies.session.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "secret-password",
    });
  });

  it("maps every provider login rejection to one generic error without secrets", async () => {
    const dependencies = ports();
    vi.mocked(dependencies.session.signInWithPassword).mockRejectedValueOnce(
      new Error("owner@example.com secret-password invalid"),
    );
    const service = createAuthenticationService(dependencies);

    const error = await service
      .login({ email: "owner@example.com", password: "secret-password" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(String(error)).toBe("InvalidCredentialsError: No se pudo iniciar sesión con esas credenciales.");
    expect(String(error)).not.toContain("owner@example.com");
    expect(String(error)).not.toContain("secret-password");
  });

  it("denies an authenticated identity without a coherent membership", async () => {
    const dependencies = ports();
    vi.mocked(dependencies.memberships.findForUser).mockResolvedValueOnce([]);
    const service = createAuthenticationService(dependencies);

    await expect(
      service.login({ email: "owner@example.com", password: "secret-password" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("returns anonymous without querying memberships", async () => {
    const dependencies = ports();
    vi.mocked(dependencies.session.getAuthenticatedUser).mockResolvedValueOnce(null);
    const service = createAuthenticationService(dependencies);

    await expect(service.currentAccess()).resolves.toBeNull();
    expect(dependencies.memberships.findForUser).not.toHaveBeenCalled();
  });

  it("delegates local session invalidation", async () => {
    const dependencies = ports();
    const service = createAuthenticationService(dependencies);

    await service.logout();

    expect(dependencies.session.signOut).toHaveBeenCalledOnce();
  });
});
