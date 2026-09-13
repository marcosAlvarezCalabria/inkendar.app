import {
  normalizeEmail,
  normalizePersonName,
  normalizeStudioName,
  validatePassword,
  validateStudioId,
} from "@inkendar/domain";

export { InvalidOnboardingInputError } from "@inkendar/domain";

export class DuplicateIdentityError extends Error {
  readonly code = "DUPLICATE_IDENTITY";

  constructor() {
    super("An identity already exists for this onboarding request");
    this.name = "DuplicateIdentityError";
  }
}

export class StudioNotFoundError extends Error {
  readonly code = "STUDIO_NOT_FOUND";

  constructor() {
    super("The target studio does not exist");
    this.name = "StudioNotFoundError";
  }
}

export class ProvisioningFailedError extends Error {
  readonly code = "PROVISIONING_FAILED";

  constructor() {
    super("Onboarding could not be completed; the Auth identity was removed");
    this.name = "ProvisioningFailedError";
  }
}

export class ProvisioningCompensationFailedError extends Error {
  readonly code = "PROVISIONING_COMPENSATION_FAILED";

  constructor(readonly userId: string) {
    super("Onboarding and Auth cleanup both failed; operator intervention is required");
    this.name = "ProvisioningCompensationFailedError";
  }
}

export type CreateConfirmedUserInput = Readonly<{ email: string; password: string }>;

export interface IdentityAdminPort {
  createConfirmedUser(input: CreateConfirmedUserInput): Promise<{ userId: string }>;
  deleteUser(userId: string): Promise<void>;
}

export type CreateStudioOwnerRecord = Readonly<{
  displayName: string;
  role: "OWNER";
  studioName: string;
  userId: string;
}>;

export type AddArtistRecord = Readonly<{
  displayName: string;
  role: "ARTIST";
  studioId: string;
  userId: string;
}>;

export interface OnboardingRepositoryPort {
  createStudioOwner(input: CreateStudioOwnerRecord): Promise<{
    studioId: string;
    userProfileId: string;
    membershipId: string;
  }>;
  addArtist(input: AddArtistRecord): Promise<{
    userProfileId: string;
    membershipId: string;
    artistProfileId: string;
  }>;
}

export type CreateStudioOwnerInput = Readonly<{
  studioName: string;
  displayName: string;
  email: string;
  password: string;
}>;

export type AddArtistInput = Readonly<{
  studioId: string;
  displayName: string;
  email: string;
  password: string;
}>;

export function createManualOnboardingService(dependencies: {
  identity: IdentityAdminPort;
  repository: OnboardingRepositoryPort;
}) {
  async function provision<T>(
    credentials: CreateConfirmedUserInput,
    persist: (userId: string) => Promise<T>,
  ): Promise<T & { userId: string }> {
    const { userId } = await dependencies.identity.createConfirmedUser(credentials);

    try {
      const result = await persist(userId);
      return { ...result, userId };
    } catch (persistenceError: unknown) {
      try {
        await dependencies.identity.deleteUser(userId);
      } catch {
        throw new ProvisioningCompensationFailedError(userId);
      }

      if (persistenceError instanceof DuplicateIdentityError || persistenceError instanceof StudioNotFoundError) {
        throw persistenceError;
      }
      throw new ProvisioningFailedError();
    }
  }

  return {
    async createStudioOwner(input: CreateStudioOwnerInput) {
      const credentials = {
        email: normalizeEmail(input.email),
        password: validatePassword(input.password),
      };
      const studioName = normalizeStudioName(input.studioName);
      const displayName = normalizePersonName(input.displayName);

      return await provision(credentials, (userId) =>
        dependencies.repository.createStudioOwner({
          displayName,
          role: "OWNER",
          studioName,
          userId,
        }),
      );
    },

    async addArtist(input: AddArtistInput) {
      const credentials = {
        email: normalizeEmail(input.email),
        password: validatePassword(input.password),
      };
      const studioId = validateStudioId(input.studioId);
      const displayName = normalizePersonName(input.displayName);

      return await provision(credentials, (userId) =>
        dependencies.repository.addArtist({
          displayName,
          role: "ARTIST",
          studioId,
          userId,
        }),
      );
    },
  };
}
