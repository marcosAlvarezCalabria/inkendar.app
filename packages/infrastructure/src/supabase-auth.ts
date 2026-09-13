import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";

import type { AuthSessionPort, LoginCredentials, MembershipAccessPort } from "@inkendar/application";
import type { AccessRole, IdentityAccessRecord } from "@inkendar/domain";

type AuthResult = Promise<{ data: { user: { id: string } | null }; error: unknown }>;
type QueryResult = Promise<{ data: unknown; error: unknown }>;

export interface SupabaseAuthClient {
  auth: {
    getUser(): AuthResult;
    signInWithPassword(credentials: LoginCredentials): AuthResult;
    signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  };
  from(table: "membership"): {
    select(columns: string): { eq(column: "user_id", value: string): QueryResult };
  };
}

export type SupabasePublicConfig = Readonly<{ publishableKey: string; url: string }>;

export function loadSupabasePublicConfig(environment: Record<string, string | undefined>): SupabasePublicConfig {
  const url = requiredEnvironment(environment, "SUPABASE_URL");
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY;
  if (!publishableKey) {
    throw new Error("Missing server environment: SUPABASE_PUBLISHABLE_KEY");
  }
  return { publishableKey, url };
}

export class SupabaseAuthenticationAdapter implements AuthSessionPort, MembershipAccessPort {
  constructor(private readonly client: SupabaseAuthClient) {}

  async signInWithPassword(credentials: LoginCredentials): Promise<{ userId: string }> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);
    if (error || !data.user?.id) {
      throw new Error("Supabase authentication operation failed");
    }
    return { userId: data.user.id };
  }

  async getAuthenticatedUser(): Promise<{ userId: string } | null> {
    const { data, error } = await this.client.auth.getUser();
    return error || !data.user?.id ? null : { userId: data.user.id };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) {
      throw new Error("Supabase authentication operation failed");
    }
  }

  async findForUser(userId: string): Promise<readonly IdentityAccessRecord[]> {
    const { data, error } = await this.client
      .from("membership")
      .select(
        "id,studio_id,user_id,role,user_profile:user_profile!membership_profile_same_studio_user_fk(id,studio_id,user_id,display_name),artist_profile:artist_profile!artist_profile_membership_same_studio_user_role_fk(membership_id,studio_id,user_id)",
      )
      .eq("user_id", userId);
    if (error || !Array.isArray(data)) {
      throw new Error("Supabase membership lookup failed");
    }
    return data.map(mapMembershipRecord);
  }
}

export function createSupabaseAuthRequestAdapter(
  request: Request,
  environment: Record<string, string | undefined>,
): { adapter: SupabaseAuthenticationAdapter; headers: Headers } {
  const config = loadSupabasePublicConfig(environment);
  const headers = privateHeaders();
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: supabaseAuthCookieOptions(environment),
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          headers.append(
            "Set-Cookie",
            serializeSupabaseAuthCookie(cookie.name, cookie.value, cookie.options, environment),
          );
        }
      },
    },
  });
  return { adapter: new SupabaseAuthenticationAdapter(client as unknown as SupabaseAuthClient), headers };
}

export function privateHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store" });
}

export function serializeSupabaseAuthCookie(
  name: string,
  value: string,
  options: CookieOptions,
  environment: Record<string, string | undefined>,
): string {
  return serializeCookieHeader(name, value, {
    ...options,
    ...supabaseAuthCookieOptions(environment),
  });
}

function supabaseAuthCookieOptions(environment: Record<string, string | undefined>): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: environment.NODE_ENV === "production",
  };
}

function requiredEnvironment(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing server environment: ${name}`);
  return value;
}

function mapMembershipRecord(value: unknown): IdentityAccessRecord {
  const row = object(value);
  const membership = {
    id: string(row.id),
    role: role(row.role),
    studioId: string(row.studio_id),
    userId: string(row.user_id),
  };
  const profile = nullableObject(row.user_profile);
  const artists = Array.isArray(row.artist_profile) ? row.artist_profile : [];
  const artist = artists.length === 1 ? object(artists[0]) : null;
  return {
    membership,
    userProfile: profile
      ? {
          id: string(profile.id),
          displayName: string(profile.display_name),
          studioId: string(profile.studio_id),
          userId: string(profile.user_id),
        }
      : null,
    artistProfile: artist
      ? {
          membershipId: string(artist.membership_id),
          studioId: string(artist.studio_id),
          userId: string(artist.user_id),
        }
      : null,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nullableObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.length === 1 ? object(value[0]) : null;
  return value !== null && typeof value === "object" ? object(value) : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function role(value: unknown): AccessRole {
  return value === "OWNER" || value === "ARTIST" ? value : ("" as AccessRole);
}
