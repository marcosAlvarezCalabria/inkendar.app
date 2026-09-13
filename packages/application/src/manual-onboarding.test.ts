import { describe, expect, it, vi } from "vitest";

import {
  DuplicateIdentityError,
  InvalidOnboardingInputError,
  PersistenceOutcomeUnknownError,
  ProvisioningCompensationFailedError,
  ProvisioningFailedError,
  ProvisioningOutcomeUnknownError,
  StudioNotFoundError,
  createManualOnboardingService,
  type IdentityAdminPort,
  type OnboardingRepositoryPort,
} from "./manual-onboarding.js";

function createPorts() {
  const identity: IdentityAdminPort = {
    createConfirmedUser: vi.fn(async () => ({ userId: "10000000-0000-4000-8000-000000000001" })),
    deleteUser: vi.fn(async () => undefined),
  };
  const repository: OnboardingRepositoryPort = {
    createStudioOwner: vi.fn(async () => ({
      studioId: "20000000-0000-4000-8000-000000000001",
      userProfileId: "30000000-0000-4000-8000-000000000001",
      membershipId: "40000000-0000-4000-8000-000000000001",
    })),
    addArtist: vi.fn(async () => ({
      userProfileId: "30000000-0000-4000-8000-000000000002",
      membershipId: "40000000-0000-4000-8000-000000000002",
      artistProfileId: "50000000-0000-4000-8000-000000000002",
    })),
  };

  return { identity, repository };
}

describe("manual onboarding", () => {
  it("normalizes trusted fields and provisions a studio owner with a fixed OWNER role", async () => {
    const { identity, repository } = createPorts();
    const onboarding = createManualOnboardingService({ identity, repository });

    await expect(
      onboarding.createStudioOwner({
        studioName: "  North   Ink  ",
        displayName: "  María   Owner ",
        email: "  OWNER@Example.COM ",
        password: "correct-horse-battery-staple",
      }),
    ).resolves.toMatchObject({ studioId: "20000000-0000-4000-8000-000000000001" });

    expect(identity.createConfirmedUser).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct-horse-battery-staple",
    });
    expect(repository.createStudioOwner).toHaveBeenCalledWith({
      displayName: "María Owner",
      role: "OWNER",
      studioName: "North Ink",
      userId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("adds an artist to a validated studio with a fixed ARTIST role", async () => {
    const { identity, repository } = createPorts();
    const onboarding = createManualOnboardingService({ identity, repository });

    await onboarding.addArtist({
      studioId: "20000000-0000-4000-8000-000000000001",
      displayName: " North Artist ",
      email: "ARTIST@example.com",
      password: "correct-horse-battery-staple",
    });

    expect(repository.addArtist).toHaveBeenCalledWith({
      displayName: "North Artist",
      role: "ARTIST",
      studioId: "20000000-0000-4000-8000-000000000001",
      userId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it.each([
    { field: "studioName", value: "   " },
    { field: "displayName", value: "bad\u0000name" },
    { field: "email", value: "not-an-email" },
    { field: "password", value: "short" },
    { field: "studioId", value: "../../another-tenant" },
  ])("rejects invalid $field before calling a provider", async ({ field, value }) => {
    const { identity, repository } = createPorts();
    const onboarding = createManualOnboardingService({ identity, repository });
    const input = {
      studioId: "20000000-0000-4000-8000-000000000001",
      displayName: "Artist",
      email: "artist@example.com",
      password: "correct-horse-battery-staple",
      [field]: value,
    };

    await expect(
      field === "studioName"
        ? onboarding.createStudioOwner({ ...input, studioName: value })
        : onboarding.addArtist(input),
    ).rejects.toBeInstanceOf(InvalidOnboardingInputError);
    expect(identity.createConfirmedUser).not.toHaveBeenCalled();
  });

  it("returns a typed duplicate without attempting persistence or deletion", async () => {
    const { identity, repository } = createPorts();
    vi.mocked(identity.createConfirmedUser).mockRejectedValueOnce(new DuplicateIdentityError());
    const onboarding = createManualOnboardingService({ identity, repository });

    await expect(
      onboarding.createStudioOwner({
        studioName: "North Ink",
        displayName: "Owner",
        email: "owner@example.com",
        password: "correct-horse-battery-staple",
      }),
    ).rejects.toBeInstanceOf(DuplicateIdentityError);
    expect(repository.createStudioOwner).not.toHaveBeenCalled();
    expect(identity.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes a newly created Auth identity when the studio does not exist", async () => {
    const { identity, repository } = createPorts();
    vi.mocked(repository.addArtist).mockRejectedValueOnce(new StudioNotFoundError());
    const onboarding = createManualOnboardingService({ identity, repository });

    await expect(
      onboarding.addArtist({
        studioId: "20000000-0000-4000-8000-000000000099",
        displayName: "Artist",
        email: "artist@example.com",
        password: "correct-horse-battery-staple",
      }),
    ).rejects.toBeInstanceOf(StudioNotFoundError);
    expect(identity.deleteUser).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
  });

  it("maps a confirmed persistence failure after successful compensation", async () => {
    const { identity, repository } = createPorts();
    vi.mocked(repository.createStudioOwner).mockRejectedValueOnce(new Error("database unavailable"));
    const onboarding = createManualOnboardingService({ identity, repository });

    await expect(
      onboarding.createStudioOwner({
        studioName: "North Ink",
        displayName: "Owner",
        email: "owner@example.com",
        password: "correct-horse-battery-staple",
      }),
    ).rejects.toBeInstanceOf(ProvisioningFailedError);
    expect(identity.deleteUser).toHaveBeenCalledOnce();
  });

  it.each([
    ["studio owner", "createStudioOwner"] as const,
    ["artist", "addArtist"] as const,
  ])("preserves Auth when the %s persistence result is ambiguous", async (_label, operation) => {
    const { identity, repository } = createPorts();
    vi.mocked(repository[operation]).mockRejectedValueOnce(new PersistenceOutcomeUnknownError());
    const onboarding = createManualOnboardingService({ identity, repository });

    const request =
      operation === "createStudioOwner"
        ? onboarding.createStudioOwner({
            studioName: "North Ink",
            displayName: "Owner",
            email: "owner@example.com",
            password: "correct-horse-battery-staple",
          })
        : onboarding.addArtist({
            studioId: "20000000-0000-4000-8000-000000000001",
            displayName: "Artist",
            email: "artist@example.com",
            password: "correct-horse-battery-staple",
          });

    await expect(request).rejects.toMatchObject({
      constructor: ProvisioningOutcomeUnknownError,
      userId: "10000000-0000-4000-8000-000000000001",
    });
    expect(identity.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a typed intervention state when compensation fails", async () => {
    const { identity, repository } = createPorts();
    vi.mocked(repository.createStudioOwner).mockRejectedValueOnce(new Error("database unavailable"));
    vi.mocked(identity.deleteUser).mockRejectedValueOnce(new Error("auth unavailable"));
    const onboarding = createManualOnboardingService({ identity, repository });

    await expect(
      onboarding.createStudioOwner({
        studioName: "North Ink",
        displayName: "Owner",
        email: "owner@example.com",
        password: "correct-horse-battery-staple",
      }),
    ).rejects.toBeInstanceOf(ProvisioningCompensationFailedError);
  });
});
