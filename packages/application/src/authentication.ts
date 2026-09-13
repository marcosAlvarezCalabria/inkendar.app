import { resolveAccess, type AuthorizedAccess, type IdentityAccessRecord } from "@inkendar/domain";

export type LoginCredentials = Readonly<{ email: string; password: string }>;

export interface AuthSessionPort {
  signInWithPassword(credentials: LoginCredentials): Promise<{ userId: string }>;
  getAuthenticatedUser(): Promise<{ userId: string } | null>;
  signOut(): Promise<void>;
}

export interface MembershipAccessPort {
  findForUser(userId: string): Promise<readonly IdentityAccessRecord[]>;
}

export class InvalidCredentialsError extends Error {
  readonly code = "INVALID_CREDENTIALS";

  constructor() {
    super("No se pudo iniciar sesión con esas credenciales.");
    this.name = "InvalidCredentialsError";
  }
}

export function createAuthenticationService(dependencies: {
  memberships: MembershipAccessPort;
  session: AuthSessionPort;
}) {
  async function accessFor(userId: string): Promise<AuthorizedAccess> {
    return resolveAccess(userId, await dependencies.memberships.findForUser(userId));
  }

  return {
    async login(credentials: LoginCredentials): Promise<AuthorizedAccess> {
      let identity: { userId: string };
      try {
        identity = await dependencies.session.signInWithPassword(credentials);
      } catch {
        throw new InvalidCredentialsError();
      }
      return await accessFor(identity.userId);
    },

    async currentAccess(): Promise<AuthorizedAccess | null> {
      const identity = await dependencies.session.getAuthenticatedUser();
      return identity ? await accessFor(identity.userId) : null;
    },

    async logout(): Promise<void> {
      await dependencies.session.signOut();
    },
  };
}
