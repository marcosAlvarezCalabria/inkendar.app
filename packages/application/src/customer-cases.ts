import {
  normalizeBodyArea,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
  normalizeResourceId,
  normalizeTattooSize,
  normalizeTattooSummary,
  validateCustomerStatus,
  validateTattooCaseStatus,
  type CustomerStatus,
  type TattooCaseStatus,
} from "@inkendar/domain";

export { InvalidCustomerCaseInputError } from "@inkendar/domain";

export type Customer = Readonly<{
  id: string;
  studioId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
}>;

export type TattooCase = Readonly<{
  id: string;
  studioId: string;
  customerId: string;
  summary: string;
  bodyArea: string | null;
  size: string | null;
  artistProfileId: string | null;
  status: TattooCaseStatus;
}>;

export type ArtistOption = Readonly<{ id: string; displayName: string }>;

export class DuplicateCustomerError extends Error {
  readonly code = "DUPLICATE_CUSTOMER";
  constructor() { super("A customer with that contact already exists"); this.name = "DuplicateCustomerError"; }
}

export class CustomerNotFoundError extends Error {
  readonly code = "CUSTOMER_NOT_FOUND";
  constructor() { super("The customer was not found"); this.name = "CustomerNotFoundError"; }
}

export class TattooCaseNotFoundError extends Error {
  readonly code = "TATTOO_CASE_NOT_FOUND";
  constructor() { super("The tattoo case was not found"); this.name = "TattooCaseNotFoundError"; }
}

export class ArtistNotFoundError extends Error {
  readonly code = "ARTIST_NOT_FOUND";
  constructor() { super("The artist was not found"); this.name = "ArtistNotFoundError"; }
}

export type CustomerRecord = Omit<Customer, "id">;
export type CustomerUpdateRecord = Omit<Customer, "studioId"> & { studioId: string };
export type TattooCaseRecord = Omit<TattooCase, "id">;
export type TattooCaseUpdateRecord = Omit<TattooCase, "studioId" | "customerId"> & { studioId: string };

export interface CustomerCasesRepositoryPort {
  listCustomers(studioId: string): Promise<readonly Customer[]>;
  findCustomer(studioId: string, id: string): Promise<Customer | null>;
  createCustomer(input: CustomerRecord): Promise<Customer>;
  updateCustomer(input: CustomerUpdateRecord): Promise<Customer | null>;
  listTattooCases(studioId: string): Promise<readonly TattooCase[]>;
  findTattooCase(studioId: string, id: string): Promise<TattooCase | null>;
  createTattooCase(input: TattooCaseRecord): Promise<TattooCase>;
  updateTattooCase(input: TattooCaseUpdateRecord): Promise<TattooCase | null>;
  listArtists(studioId: string): Promise<readonly ArtistOption[]>;
  artistExists(studioId: string, id: string): Promise<boolean>;
}

export type CreateCustomerInput = Readonly<{ name: string; email?: string | undefined; phone?: string | undefined }>;
export type UpdateCustomerInput = Readonly<{ name: string; email?: string | undefined; phone?: string | undefined; status: string }>;
export type CreateTattooCaseInput = Readonly<{ customerId: string; summary: string; bodyArea?: string | undefined; size?: string | undefined; artistProfileId?: string | undefined }>;
export type UpdateTattooCaseInput = Readonly<{ summary: string; bodyArea?: string | undefined; size?: string | undefined; artistProfileId?: string | undefined; status: string }>;

export function createCustomerCasesService(repository: CustomerCasesRepositoryPort) {
  async function ownArtist(studioId: string, value: string | undefined): Promise<string | null> {
    if (value === undefined || value.trim().length === 0) return null;
    const artistId = normalizeResourceId("artistProfileId", value);
    if (!(await repository.artistExists(studioId, artistId))) throw new ArtistNotFoundError();
    return artistId;
  }

  return {
    listCustomers: (studioId: string) => repository.listCustomers(studioId),
    listTattooCases: (studioId: string) => repository.listTattooCases(studioId),
    listArtists: (studioId: string) => repository.listArtists(studioId),

    async createCustomer(studioId: string, input: CreateCustomerInput): Promise<Customer> {
      return await repository.createCustomer({
        studioId,
        name: normalizeCustomerName(input.name),
        email: normalizeCustomerEmail(input.email),
        phone: normalizeCustomerPhone(input.phone),
        status: "ACTIVE",
      });
    },

    async updateCustomer(studioId: string, id: string, input: UpdateCustomerInput): Promise<Customer> {
      const result = await repository.updateCustomer({
        studioId,
        id: normalizeResourceId("id", id),
        name: normalizeCustomerName(input.name),
        email: normalizeCustomerEmail(input.email),
        phone: normalizeCustomerPhone(input.phone),
        status: validateCustomerStatus(input.status),
      });
      if (!result) throw new CustomerNotFoundError();
      return result;
    },

    async createTattooCase(studioId: string, input: CreateTattooCaseInput): Promise<TattooCase> {
      const customerId = normalizeResourceId("customerId", input.customerId);
      if (!(await repository.findCustomer(studioId, customerId))) throw new CustomerNotFoundError();
      return await repository.createTattooCase({
        studioId,
        customerId,
        summary: normalizeTattooSummary(input.summary),
        bodyArea: normalizeBodyArea(input.bodyArea),
        size: normalizeTattooSize(input.size),
        artistProfileId: await ownArtist(studioId, input.artistProfileId),
        status: "OPEN",
      });
    },

    async updateTattooCase(studioId: string, id: string, input: UpdateTattooCaseInput): Promise<TattooCase> {
      const result = await repository.updateTattooCase({
        studioId,
        id: normalizeResourceId("id", id),
        summary: normalizeTattooSummary(input.summary),
        bodyArea: normalizeBodyArea(input.bodyArea),
        size: normalizeTattooSize(input.size),
        artistProfileId: await ownArtist(studioId, input.artistProfileId),
        status: validateTattooCaseStatus(input.status),
      });
      if (!result) throw new TattooCaseNotFoundError();
      return result;
    },
  };
}
