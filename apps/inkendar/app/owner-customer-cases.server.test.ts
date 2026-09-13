import { describe, expect, it, vi } from "vitest";

import { DuplicateCustomerError, createCustomerCasesService, type CustomerCasesRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerCustomerCasesHandlers, type OwnerAuthorization } from "./owner-customer-cases.server.js";

const access: AuthorizedAccess = {
  displayName: "Owner", role: "OWNER", studioId: "20000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001",
};

function repository(): CustomerCasesRepositoryPort {
  return {
    listCustomers: vi.fn(async () => []), findCustomer: vi.fn(async () => null), createCustomer: vi.fn(), updateCustomer: vi.fn(),
    listTattooCases: vi.fn(async () => []), findTattooCase: vi.fn(async () => null), createTattooCase: vi.fn(), updateTattooCase: vi.fn(),
    listArtists: vi.fn(async () => []), artistExists: vi.fn(async () => false),
  };
}

function handlers(repo = repository(), authorize: () => Promise<OwnerAuthorization> = async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) })) {
  return { repo, handlers: createOwnerCustomerCasesHandlers({ authorize, service: () => createCustomerCasesService(repo) }) };
}

describe("owner customer and case handlers", () => {
  it("lists owner data with a private no-store response", async () => {
    const { handlers: subject, repo } = handlers();
    const response = await subject.customersLoader(new Request("https://app.inkendar.es/app/owner/customers"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
    expect(repo.listCustomers).toHaveBeenCalledWith(access.studioId);
  });

  it("rejects an artist through the existing owner guard before reading data", async () => {
    const denied = new Response("Acceso denegado", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    const { handlers: subject, repo } = handlers(repository(), async () => denied);
    const response = await subject.customersLoader(new Request("https://app.inkendar.es/app/owner/customers"));
    expect(response.status).toBe(403);
    expect(repo.listCustomers).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before reading the form", async () => {
    const { handlers: subject, repo } = handlers();
    const request = new Request("https://app.inkendar.es/app/owner/customers", { method: "POST", headers: { Origin: "https://evil.example" }, body: new FormData() });
    const response = await subject.customerAction(request);
    expect(response.status).toBe(403);
    expect(repo.createCustomer).not.toHaveBeenCalled();
  });

  it("creates a customer using the studio from authorized access", async () => {
    const repo = repository();
    vi.mocked(repo.createCustomer).mockImplementation(async (record) => ({ id: "60000000-0000-4000-8000-000000000001", ...record }));
    const { handlers: subject } = handlers(repo);
    const form = new FormData(); form.set("intent", "create"); form.set("name", " María "); form.set("email", ""); form.set("phone", "");
    const response = await subject.customerAction(mutation("/app/owner/customers", form));
    expect(response.status).toBe(303);
    expect(repo.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ studioId: access.studioId, name: "María" }));
  });

  it("returns generic private validation and duplicate errors without submitted PII", async () => {
    const repo = repository();
    vi.mocked(repo.createCustomer).mockRejectedValueOnce(new DuplicateCustomerError());
    const { handlers: subject } = handlers(repo);
    const form = new FormData(); form.set("intent", "create"); form.set("name", "Private Person"); form.set("email", "private@example.test");
    const response = await subject.customerAction(mutation("/app/owner/customers", form));
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).not.toContain("Private Person");
    expect(body).not.toContain("private@example.test");
  });
});

function mutation(path: string, body: FormData): Request {
  return new Request(`https://app.inkendar.es${path}`, { method: "POST", headers: { Origin: "https://app.inkendar.es", "Sec-Fetch-Site": "same-origin" }, body });
}
