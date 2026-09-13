import { describe, expect, it, vi } from "vitest";

import { createCustomerCasesService, type CustomerCasesRepositoryPort } from "@inkendar/application";
import { createOwnerCustomerCasesHandlers } from "./owner-customer-cases.server.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const artistId = "50000000-0000-4000-8000-000000000001";

function repository(): CustomerCasesRepositoryPort {
  return {
    listCustomers: vi.fn(async () => []),
    findCustomer: vi.fn(async () => ({ id: customerId, studioId, name: "Client", email: null, phone: null, status: "ACTIVE" as const })),
    createCustomer: vi.fn(), updateCustomer: vi.fn(), listTattooCases: vi.fn(async () => []), findTattooCase: vi.fn(async () => null),
    createTattooCase: vi.fn(async (record) => ({ id: "70000000-0000-4000-8000-000000000001", ...record })),
    updateTattooCase: vi.fn(), listArtists: vi.fn(async () => []), artistExists: vi.fn(async () => true),
  };
}

describe("owner tattoo case action", () => {
  it("creates a case and assigns an own-studio artist from server-authorized context", async () => {
    const repo = repository();
    const handlers = createOwnerCustomerCasesHandlers({
      authorize: async () => ({ access: { displayName: "Owner", role: "OWNER", studioId, userId: "10000000-0000-4000-8000-000000000001" }, headers: new Headers() }),
      service: () => createCustomerCasesService(repo),
    });
    const form = new FormData();
    form.set("intent", "create"); form.set("customerId", customerId); form.set("summary", " Floral "); form.set("bodyArea", ""); form.set("size", ""); form.set("artistProfileId", artistId);

    const response = await handlers.caseAction(new Request("https://app.inkendar.es/app/owner/cases", {
      method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body: form,
    }));

    expect(response.status).toBe(303);
    expect(repo.artistExists).toHaveBeenCalledWith(studioId, artistId);
    expect(repo.createTattooCase).toHaveBeenCalledWith(expect.objectContaining({ studioId, customerId, artistProfileId: artistId }));
  });
});
