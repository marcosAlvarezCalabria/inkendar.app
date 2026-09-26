import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccessSuspensionRepositoryPort, StudioMember } from "@inkendar/application";
import { AccessDeniedError, type AccessStatus } from "@inkendar/domain";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type DataResult = Readonly<{ data: unknown; error: unknown }>;

export interface AccessSuspensionDataGateway {
  listMembers(studioId: string): Promise<DataResult>;
  setArtistStatus(membershipId: string, status: AccessStatus): Promise<DataResult>;
}

export class SupabaseAccessSuspensionGateway implements AccessSuspensionDataGateway {
  constructor(private readonly client: SupabaseClient) {}

  async listMembers(studioId: string): Promise<DataResult> {
    const { data, error } = await this.client
      .from("membership")
      .select("id,role,status,user_profile!membership_profile_same_studio_user_fk(display_name)")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: true });
    return { data, error };
  }

  async setArtistStatus(membershipId: string, status: AccessStatus): Promise<DataResult> {
    const { data, error } = await this.client.rpc("set_artist_access", {
      p_membership_id: membershipId,
      p_status: status,
    });
    return { data, error };
  }
}

export class SupabaseAccessSuspensionRepository implements AccessSuspensionRepositoryPort {
  constructor(private readonly data: AccessSuspensionDataGateway) {}

  async listMembers(studioId: string): Promise<readonly StudioMember[]> {
    const result = await this.data.listMembers(studioId);
    if (result.error || !Array.isArray(result.data)) failed();
    return result.data.map(member);
  }

  async setArtistStatus(membershipId: string, status: AccessStatus): Promise<void> {
    const result = await this.data.setArtistStatus(membershipId, status);
    if (errorCode(result.error) === "42501") throw new AccessDeniedError();
    if (result.error) failed();
  }
}

export function createSupabaseAccessSuspensionRequestRepository(
  request: Request,
  environment: Record<string, string | undefined>,
): SupabaseAccessSuspensionRepository {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined },
  });
  return new SupabaseAccessSuspensionRepository(new SupabaseAccessSuspensionGateway(client));
}

function member(value: unknown): StudioMember {
  const row = object(value);
  const profile = object(row.user_profile);
  const role = row.role;
  const status = row.status;
  if ((role !== "OWNER" && role !== "ARTIST") || (status !== "ACTIVE" && status !== "SUSPENDED")) failed();
  const displayName = string(profile.display_name);
  if (displayName.length > 120) failed();
  return { id: string(row.id), displayName, role, status };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) failed();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) failed();
  return value;
}

function failed(): never {
  throw new Error("Artist access persistence failed");
}

function errorCode(value: unknown): string | null {
  return value && typeof value === "object" && "code" in value && typeof value.code === "string"
    ? value.code
    : null;
}
