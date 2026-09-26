import { AccessDeniedError, type AccessRole, type AccessStatus, type AuthorizedAccess } from "@inkendar/domain";

export type StudioMember = Readonly<{
  id: string;
  displayName: string;
  role: AccessRole;
  status: AccessStatus;
}>;

export interface AccessSuspensionRepositoryPort {
  listMembers(studioId: string): Promise<readonly StudioMember[]>;
  setArtistStatus(membershipId: string, status: AccessStatus): Promise<void>;
}

export class InvalidAccessChangeError extends Error {
  readonly code = "INVALID_ACCESS_CHANGE";
  constructor() {
    super("Invalid artist access change");
    this.name = "InvalidAccessChangeError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAccessSuspensionService(repository: AccessSuspensionRepositoryPort) {
  function requireOwner(actor: AuthorizedAccess): void {
    if (actor.role !== "OWNER") throw new AccessDeniedError();
  }

  return {
    async listMembers(actor: AuthorizedAccess): Promise<readonly StudioMember[]> {
      requireOwner(actor);
      return await repository.listMembers(actor.studioId);
    },

    async setArtistStatus(actor: AuthorizedAccess, membershipId: string, status: string): Promise<void> {
      requireOwner(actor);
      const normalizedId = membershipId.trim().toLowerCase();
      if (!UUID_PATTERN.test(normalizedId) || (status !== "ACTIVE" && status !== "SUSPENDED")) {
        throw new InvalidAccessChangeError();
      }
      await repository.setArtistStatus(normalizedId, status);
    },
  };
}
