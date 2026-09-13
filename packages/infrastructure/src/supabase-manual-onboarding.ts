import {
  DuplicateIdentityError,
  StudioNotFoundError,
  type AddArtistRecord,
  type CreateConfirmedUserInput,
  type CreateStudioOwnerRecord,
  type IdentityAdminPort,
  type OnboardingRepositoryPort,
} from "@inkendar/application";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type AdapterOptions = Readonly<{
  supabaseUrl: string;
  serviceRoleKey: string;
  fetch?: Fetch;
}>;

export class SupabaseOnboardingAdapterError extends Error {
  readonly code = "SUPABASE_ONBOARDING_ADAPTER_FAILED";

  constructor() {
    super("Supabase onboarding operation failed");
    this.name = "SupabaseOnboardingAdapterError";
  }
}

export class SupabaseManualOnboardingAdapter implements IdentityAdminPort, OnboardingRepositoryPort {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;
  readonly #headers: Readonly<Record<string, string>>;

  constructor(options: AdapterOptions) {
    this.#baseUrl = normalizeBaseUrl(options.supabaseUrl);
    if (options.serviceRoleKey.trim().length === 0) {
      throw new SupabaseOnboardingAdapterError();
    }
    this.#headers = {
      apikey: options.serviceRoleKey,
      authorization: `Bearer ${options.serviceRoleKey}`,
      "content-type": "application/json",
    };
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async createConfirmedUser(input: CreateConfirmedUserInput): Promise<{ userId: string }> {
    const response = await this.#request("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
      }),
    });
    const body = await readJson(response);

    if (!response.ok) {
      if (response.status === 422 && providerMessage(body).match(/already(?: been)? (registered|exists)/i)) {
        throw new DuplicateIdentityError();
      }
      throw new SupabaseOnboardingAdapterError();
    }

    const userId = recordString(body, "id");
    if (!userId) {
      throw new SupabaseOnboardingAdapterError();
    }
    return { userId };
  }

  async deleteUser(userId: string): Promise<void> {
    const response = await this.#request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new SupabaseOnboardingAdapterError();
    }
  }

  async createStudioOwner(input: CreateStudioOwnerRecord) {
    const row = await this.#rpc("provision_studio_owner", {
      p_display_name: input.displayName,
      p_studio_name: input.studioName,
      p_user_id: input.userId,
    });
    return {
      studioId: requiredRowString(row, "studio_id"),
      userProfileId: requiredRowString(row, "user_profile_id"),
      membershipId: requiredRowString(row, "membership_id"),
    };
  }

  async addArtist(input: AddArtistRecord) {
    const row = await this.#rpc("provision_studio_artist", {
      p_display_name: input.displayName,
      p_studio_id: input.studioId,
      p_user_id: input.userId,
    });
    return {
      userProfileId: requiredRowString(row, "user_profile_id"),
      membershipId: requiredRowString(row, "membership_id"),
      artistProfileId: requiredRowString(row, "artist_profile_id"),
    };
  }

  async #rpc(name: string, parameters: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    const response = await this.#request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(parameters),
    });
    const body = await readJson(response);

    if (!response.ok) {
      const message = providerMessage(body);
      const code = recordString(body, "code");
      if (message === "STUDIO_NOT_FOUND") {
        throw new StudioNotFoundError();
      }
      if (message === "DUPLICATE_IDENTITY" || code === "23505") {
        throw new DuplicateIdentityError();
      }
      throw new SupabaseOnboardingAdapterError();
    }

    if (!Array.isArray(body) || body.length !== 1 || !isRecord(body[0])) {
      throw new SupabaseOnboardingAdapterError();
    }
    return body[0];
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers: this.#headers });
    } catch {
      throw new SupabaseOnboardingAdapterError();
    }
  }
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
      throw new Error();
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new SupabaseOnboardingAdapterError();
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function requiredRowString(row: Record<string, unknown>, key: string): string {
  const value = recordString(row, key);
  if (!value) throw new SupabaseOnboardingAdapterError();
  return value;
}

function providerMessage(value: unknown): string {
  return recordString(value, "message") ?? recordString(value, "msg") ?? "";
}
