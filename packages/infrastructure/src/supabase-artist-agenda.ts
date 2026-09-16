import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtistAgendaItem, ArtistAgendaRepositoryPort } from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type Result = Readonly<{ data: unknown; error: unknown }>;

export interface ArtistAgendaDataGateway {
  listUpcoming(parameters: Readonly<Record<string, unknown>>): Promise<Result>;
}

export class SupabaseArtistAgendaRepository implements ArtistAgendaRepositoryPort {
  constructor(private readonly data: ArtistAgendaDataGateway) {}

  async listUpcoming(input: Readonly<{ nowUtc: string; limit: number }>): Promise<readonly ArtistAgendaItem[]> {
    const result = await this.data.listUpcoming({ p_now: input.nowUtc, p_limit: input.limit });
    if (result.error || !Array.isArray(result.data)) failed();
    return result.data.map(agendaItem);
  }
}

export class SupabaseArtistAgendaGateway implements ArtistAgendaDataGateway {
  constructor(private readonly client: Pick<SupabaseClient, "rpc">) {}

  async listUpcoming(parameters: Readonly<Record<string, unknown>>): Promise<Result> {
    const { data, error } = await this.client.rpc("get_artist_agenda", parameters);
    return { data, error };
  }
}

export function createSupabaseArtistAgendaRequestRepository(
  request: Request,
  environment: Record<string, string | undefined>,
): SupabaseArtistAgendaRepository {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""),
      setAll: () => undefined,
    },
  });
  return new SupabaseArtistAgendaRepository(new SupabaseArtistAgendaGateway(client));
}

function agendaItem(value: unknown): ArtistAgendaItem {
  const row = object(value);
  const startUtc = timestamp(row.start_at);
  const endUtc = timestamp(row.end_at);
  if (startUtc >= endUtc) failed();
  return {
    startUtc,
    endUtc,
    customerDisplayName: boundedString(row.customer_display_name, 120),
    caseSummary: boundedString(row.case_summary, 500),
    bodyArea: nullableBoundedString(row.body_area, 120),
    size: nullableBoundedString(row.size, 120),
    timeZone: boundedString(row.time_zone, 128),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failed();
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) failed();
  return value;
}

function nullableBoundedString(value: unknown, maximum: number): string | null {
  return value === null ? null : boundedString(value, maximum);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") failed();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) failed();
  return parsed.toISOString();
}

function failed(): never {
  throw new Error("Artist agenda persistence failed");
}
