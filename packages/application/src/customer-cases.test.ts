import { describe, expect, it, vi } from "vitest";

import {
  ArtistNotFoundError,
  CustomerNotFoundError,
  TattooCaseNotFoundError,
  createCustomerCasesService,
  type CustomerCasesRepositoryPort,
} from "./customer-cases.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const artistId = "50000000-0000-4000-8000-000000000001";
const caseId = "70000000-0000-4000-8000-000000000001";

function repository(): CustomerCasesRepositoryPort {
  return {
    listCustomers: vi.fn(async () => []),
    findCustomer: vi.fn(async () => ({ id: customerId, studioId, name: "María", email: null, phone: null, status: "ACTIVE" as const })),
    createCustomer: vi.fn(async (record) => ({ id: customerId, ...record })),
    updateCustomer: vi.fn(async (record) => ({ id: customerId, ...record })),
    listTattooCases: vi.fn(async () => []),
    findTattooCase: vi.fn(async () => ({ id: caseId, studioId, customerId, summary: "Floral", bodyArea: null, size: null, artistProfileId: null, status: "OPEN" as const })),
    createTattooCase: vi.fn(async (record) => ({ id: caseId, ...record })),
    updateTattooCase: vi.fn(async (record) => ({ id: caseId, ...record })),
    listArtists: vi.fn(async () => [{ id: artistId, displayName: "Artist" }]),
    artistExists: vi.fn(async () => true),
  };
}

describe("customer and tattoo case service", () => {
  it("creates a normalized active customer in the authorized studio", async () => {
    const repo = repository();
    const service = createCustomerCasesService(repo);

    await service.createCustomer(studioId, {
      name: "  María   López ", email: " CLIENT@Example.com ", phone: " +34 600-123-456 ",
    });

    expect(repo.createCustomer).toHaveBeenCalledWith({
      studioId, name: "María López", email: "client@example.com", phone: "+34600123456", status: "ACTIVE",
    });
  });

  it("creates a case only for a visible customer and artist", async () => {
    const repo = repository();
    const service = createCustomerCasesService(repo);

    await service.createTattooCase(studioId, {
      customerId, summary: "  Floral   en negro ", bodyArea: " Antebrazo ", size: " 12 cm ", artistProfileId: artistId,
    });

    expect(repo.findCustomer).toHaveBeenCalledWith(studioId, customerId);
    expect(repo.artistExists).toHaveBeenCalledWith(studioId, artistId);
    expect(repo.createTattooCase).toHaveBeenCalledWith({
      studioId, customerId, summary: "Floral en negro", bodyArea: "Antebrazo", size: "12 cm", artistProfileId: artistId, status: "OPEN",
    });
  });

  it("fails with generic not-found errors for invisible relationships", async () => {
    const repo = repository();
    vi.mocked(repo.findCustomer).mockResolvedValueOnce(null);
    const service = createCustomerCasesService(repo);
    await expect(service.createTattooCase(studioId, { customerId, summary: "Floral" })).rejects.toBeInstanceOf(CustomerNotFoundError);

    vi.mocked(repo.findCustomer).mockResolvedValueOnce({ id: customerId, studioId, name: "M", email: null, phone: null, status: "ACTIVE" });
    vi.mocked(repo.artistExists).mockResolvedValueOnce(false);
    await expect(service.createTattooCase(studioId, { customerId, summary: "Floral", artistProfileId: artistId })).rejects.toBeInstanceOf(ArtistNotFoundError);
  });

  it("updates only agreed customer fields and archives without deletion", async () => {
    const repo = repository();
    const service = createCustomerCasesService(repo);

    await service.updateCustomer(studioId, customerId, { name: " María ", email: "", phone: "", status: "ARCHIVED" });

    expect(repo.updateCustomer).toHaveBeenCalledWith({ studioId, id: customerId, name: "María", email: null, phone: null, status: "ARCHIVED" });
  });

  it("supports assigning and clearing an own-studio artist", async () => {
    const repo = repository();
    const service = createCustomerCasesService(repo);

    await service.updateTattooCase(studioId, caseId, { summary: " Línea fina ", bodyArea: "", size: "", artistProfileId: "", status: "ARCHIVED" });

    expect(repo.updateTattooCase).toHaveBeenCalledWith({ studioId, id: caseId, summary: "Línea fina", bodyArea: null, size: null, artistProfileId: null, status: "ARCHIVED" });
  });

  it("maps absent update targets to resource-specific generic errors", async () => {
    const repo = repository();
    vi.mocked(repo.updateCustomer).mockResolvedValueOnce(null);
    vi.mocked(repo.updateTattooCase).mockResolvedValueOnce(null);
    const service = createCustomerCasesService(repo);

    await expect(service.updateCustomer(studioId, customerId, { name: "M", status: "ACTIVE" })).rejects.toBeInstanceOf(CustomerNotFoundError);
    await expect(service.updateTattooCase(studioId, caseId, { summary: "S", status: "OPEN" })).rejects.toBeInstanceOf(TattooCaseNotFoundError);
  });
});
