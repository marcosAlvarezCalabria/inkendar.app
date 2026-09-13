export type AccessRole = "OWNER" | "ARTIST";

export type IdentityAccessRecord = Readonly<{
  membership: Readonly<{ id: string; role: AccessRole; studioId: string; userId: string }>;
  userProfile: Readonly<{
    id: string;
    displayName: string;
    studioId: string;
    userId: string;
  }> | null;
  artistProfile: Readonly<{ membershipId: string; studioId: string; userId: string }> | null;
}>;

export type AuthorizedAccess = Readonly<{
  displayName: string;
  role: AccessRole;
  studioId: string;
  userId: string;
}>;

export class AccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED";

  constructor() {
    super("The authenticated identity has no coherent application access");
    this.name = "AccessDeniedError";
  }
}

export function resolveAccess(userId: string, records: readonly IdentityAccessRecord[]): AuthorizedAccess {
  if (!userId || records.length !== 1) {
    throw new AccessDeniedError();
  }

  const [record] = records;
  if (!record || !isCoherentRecord(userId, record)) {
    throw new AccessDeniedError();
  }

  return {
    displayName: record.userProfile.displayName,
    role: record.membership.role,
    studioId: record.membership.studioId,
    userId,
  };
}

function isCoherentRecord(userId: string, record: IdentityAccessRecord): record is IdentityAccessRecord & {
  userProfile: NonNullable<IdentityAccessRecord["userProfile"]>;
} {
  const { membership, userProfile, artistProfile } = record;
  if (
    !membership.id ||
    !membership.studioId ||
    membership.userId !== userId ||
    !userProfile ||
    !userProfile.id ||
    !userProfile.displayName.trim() ||
    userProfile.userId !== userId ||
    userProfile.studioId !== membership.studioId
  ) {
    return false;
  }

  if (membership.role === "OWNER") {
    return artistProfile === null;
  }

  return (
    membership.role === "ARTIST" &&
    artistProfile !== null &&
    artistProfile.membershipId === membership.id &&
    artistProfile.userId === userId &&
    artistProfile.studioId === membership.studioId
  );
}
