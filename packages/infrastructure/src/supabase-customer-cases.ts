import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CustomerNotFoundError,
  DuplicateCustomerError,
  type ArtistOption,
  type Customer,
  type CustomerCasesRepositoryPort,
  type CustomerRecord,
  type CustomerUpdateRecord,
  type TattooCase,
  type TattooCaseRecord,
  type TattooCaseUpdateRecord,
} from "@inkendar/application";
import { loadSupabasePublicConfig } from "./supabase-auth.js";

type Table = "artist_profile" | "customer" | "tattoo_case";
type DataResult = Readonly<{ data: unknown; error: unknown }>;

export interface CustomerCasesDataGateway {
  selectMany(table: Table, columns: string, filters: Readonly<Record<string, string>>, orderBy: string): Promise<DataResult>;
  selectOne(table: Table, columns: string, filters: Readonly<Record<string, string>>): Promise<DataResult>;
  insertOne(table: "customer" | "tattoo_case", values: Readonly<Record<string, unknown>>, columns: string): Promise<DataResult>;
  updateOne(table: "customer" | "tattoo_case", values: Readonly<Record<string, unknown>>, filters: Readonly<Record<string, string>>, columns: string): Promise<DataResult>;
}

export class SupabaseCustomerCasesGateway implements CustomerCasesDataGateway {
  constructor(private readonly client: SupabaseClient) {}

  async selectMany(table: Table, columns: string, filters: Readonly<Record<string, string>>, orderBy: string): Promise<DataResult> {
    let query = this.client.from(table).select(columns);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.order(orderBy, { ascending: true });
    return { data, error };
  }

  async selectOne(table: Table, columns: string, filters: Readonly<Record<string, string>>): Promise<DataResult> {
    let query = this.client.from(table).select(columns);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.maybeSingle();
    return { data, error };
  }

  async insertOne(table: "customer" | "tattoo_case", values: Readonly<Record<string, unknown>>, columns: string): Promise<DataResult> {
    const { data, error } = await this.client.from(table).insert(values).select(columns).single();
    return { data, error };
  }

  async updateOne(table: "customer" | "tattoo_case", values: Readonly<Record<string, unknown>>, filters: Readonly<Record<string, string>>, columns: string): Promise<DataResult> {
    let query = this.client.from(table).update(values);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.select(columns).maybeSingle();
    return { data, error };
  }
}

export class SupabaseCustomerCasesAdapterError extends Error {
  readonly code = "SUPABASE_CUSTOMER_CASES_FAILED";
  constructor() { super("Customer and tattoo case persistence failed"); this.name = "SupabaseCustomerCasesAdapterError"; }
}

const CUSTOMER_COLUMNS = "id,studio_id,name,email,phone,status";
const CASE_COLUMNS = "id,studio_id,customer_id,summary,body_area,size,artist_profile_id,status";

export class SupabaseCustomerCasesAdapter implements CustomerCasesRepositoryPort {
  constructor(private readonly data: CustomerCasesDataGateway) {}

  async listCustomers(studioId: string): Promise<readonly Customer[]> {
    const result = await this.data.selectMany("customer", CUSTOMER_COLUMNS, { studio_id: studioId }, "name");
    return rows(result).map(customer);
  }

  async findCustomer(studioId: string, id: string): Promise<Customer | null> {
    const result = await this.data.selectOne("customer", CUSTOMER_COLUMNS, { studio_id: studioId, id });
    return nullableRow(result, customer);
  }

  async createCustomer(input: CustomerRecord): Promise<Customer> {
    const result = await this.data.insertOne("customer", customerValues(input), CUSTOMER_COLUMNS);
    if (errorCode(result.error) === "23505") throw new DuplicateCustomerError();
    return requiredRow(result, customer);
  }

  async updateCustomer(input: CustomerUpdateRecord): Promise<Customer | null> {
    const result = await this.data.updateOne("customer", customerValues(input), { studio_id: input.studioId, id: input.id }, CUSTOMER_COLUMNS);
    if (errorCode(result.error) === "23505") throw new DuplicateCustomerError();
    return nullableRow(result, customer);
  }

  async listTattooCases(studioId: string): Promise<readonly TattooCase[]> {
    const result = await this.data.selectMany("tattoo_case", CASE_COLUMNS, { studio_id: studioId }, "created_at");
    return rows(result).map(tattooCase);
  }

  async findTattooCase(studioId: string, id: string): Promise<TattooCase | null> {
    return nullableRow(await this.data.selectOne("tattoo_case", CASE_COLUMNS, { studio_id: studioId, id }), tattooCase);
  }

  async createTattooCase(input: TattooCaseRecord): Promise<TattooCase> {
    const result = await this.data.insertOne("tattoo_case", caseValues(input), CASE_COLUMNS);
    if (errorCode(result.error) === "23503") throw new CustomerNotFoundError();
    return requiredRow(result, tattooCase);
  }

  async updateTattooCase(input: TattooCaseUpdateRecord): Promise<TattooCase | null> {
    const result = await this.data.updateOne("tattoo_case", caseValues(input), { studio_id: input.studioId, id: input.id }, CASE_COLUMNS);
    if (errorCode(result.error) === "23503") throw new CustomerNotFoundError();
    return nullableRow(result, tattooCase);
  }

  async listArtists(studioId: string): Promise<readonly ArtistOption[]> {
    const result = await this.data.selectMany("artist_profile", "id,display_name", { studio_id: studioId }, "display_name");
    return rows(result).map((row) => ({ id: string(row.id), displayName: string(row.display_name) }));
  }

  async artistExists(studioId: string, id: string): Promise<boolean> {
    const result = await this.data.selectOne("artist_profile", "id", { studio_id: studioId, id });
    if (result.error) throw new SupabaseCustomerCasesAdapterError();
    return result.data !== null;
  }
}

export function createSupabaseCustomerCasesRequestAdapter(request: Request, environment: Record<string, string | undefined>): SupabaseCustomerCasesAdapter {
  const config = loadSupabasePublicConfig(environment);
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: { getAll: () => parseCookieHeader(request.headers.get("Cookie") ?? ""), setAll: () => undefined },
  });
  return new SupabaseCustomerCasesAdapter(new SupabaseCustomerCasesGateway(client));
}

function customerValues(input: CustomerRecord | CustomerUpdateRecord): Readonly<Record<string, unknown>> {
  return { studio_id: input.studioId, name: input.name, email: input.email, phone: input.phone, status: input.status };
}

function caseValues(input: TattooCaseRecord | TattooCaseUpdateRecord): Readonly<Record<string, unknown>> {
  return { studio_id: input.studioId, ...("customerId" in input ? { customer_id: input.customerId } : {}), summary: input.summary, body_area: input.bodyArea, size: input.size, artist_profile_id: input.artistProfileId, status: input.status };
}

function rows(result: DataResult): Record<string, unknown>[] {
  if (result.error || !Array.isArray(result.data)) throw new SupabaseCustomerCasesAdapterError();
  return result.data.map(object);
}

function nullableRow<T>(result: DataResult, map: (row: Record<string, unknown>) => T): T | null {
  if (result.error) throw new SupabaseCustomerCasesAdapterError();
  return result.data === null ? null : map(object(result.data));
}

function requiredRow<T>(result: DataResult, map: (row: Record<string, unknown>) => T): T {
  if (result.error || result.data === null) throw new SupabaseCustomerCasesAdapterError();
  return map(object(result.data));
}

function customer(row: Record<string, unknown>): Customer {
  const status = string(row.status);
  if (status !== "ACTIVE" && status !== "ARCHIVED") throw new SupabaseCustomerCasesAdapterError();
  return { id: string(row.id), studioId: string(row.studio_id), name: string(row.name), email: nullableString(row.email), phone: nullableString(row.phone), status };
}

function tattooCase(row: Record<string, unknown>): TattooCase {
  const status = string(row.status);
  if (status !== "OPEN" && status !== "ARCHIVED") throw new SupabaseCustomerCasesAdapterError();
  return { id: string(row.id), studioId: string(row.studio_id), customerId: string(row.customer_id), summary: string(row.summary), bodyArea: nullableString(row.body_area), size: nullableString(row.size), artistProfileId: nullableString(row.artist_profile_id), status };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SupabaseCustomerCasesAdapterError();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new SupabaseCustomerCasesAdapterError();
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}
