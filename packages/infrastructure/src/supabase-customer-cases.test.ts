import { describe, expect, it, vi } from "vitest";

import { DuplicateCustomerError } from "@inkendar/application";
import { SupabaseCustomerCasesAdapter, type CustomerCasesDataGateway } from "./supabase-customer-cases.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";

function gateway(): CustomerCasesDataGateway {
  return {
    selectMany: vi.fn(async () => ({ data: [], error: null })),
    selectOne: vi.fn(async () => ({ data: null, error: null })),
    insertOne: vi.fn(async (_table, row) => ({ data: { id: customerId, ...row }, error: null })),
    updateOne: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase customer cases adapter", () => {
  it("scopes every customer query explicitly to the authorized studio", async () => {
    const data = gateway();
    vi.mocked(data.selectMany).mockResolvedValueOnce({
      data: [{ id: customerId, studio_id: studioId, name: "María", email: null, phone: null, status: "ACTIVE" }], error: null,
    });
    const adapter = new SupabaseCustomerCasesAdapter(data);

    await expect(adapter.listCustomers(studioId)).resolves.toEqual([
      { id: customerId, studioId, name: "María", email: null, phone: null, status: "ACTIVE" },
    ]);
    expect(data.selectMany).toHaveBeenCalledWith("customer", expect.any(String), { studio_id: studioId }, "name");
  });

  it("maps contact uniqueness without exposing provider details or PII", async () => {
    const data = gateway();
    vi.mocked(data.insertOne).mockResolvedValueOnce({
      data: null, error: { code: "23505", message: "client@example.test conflicts with customer_email_unique" },
    });
    const adapter = new SupabaseCustomerCasesAdapter(data);

    const error = await adapter.createCustomer({ studioId, name: "María", email: "client@example.test", phone: null, status: "ACTIVE" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DuplicateCustomerError);
    expect(String(error)).not.toContain("client@example.test");
    expect(String(error)).not.toContain("customer_email_unique");
  });

  it("returns null for an update hidden by RLS", async () => {
    const adapter = new SupabaseCustomerCasesAdapter(gateway());
    await expect(adapter.updateCustomer({ id: customerId, studioId, name: "M", email: null, phone: null, status: "ACTIVE" })).resolves.toBeNull();
  });

  it("uses tenant filters for own-studio artist lookup", async () => {
    const data = gateway();
    const adapter = new SupabaseCustomerCasesAdapter(data);
    await adapter.artistExists(studioId, "50000000-0000-4000-8000-000000000001");
    expect(data.selectOne).toHaveBeenCalledWith("artist_profile", "id", {
      studio_id: studioId, id: "50000000-0000-4000-8000-000000000001",
    });
  });
});
