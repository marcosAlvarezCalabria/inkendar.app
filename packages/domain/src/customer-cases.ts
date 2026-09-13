export type CustomerStatus = "ACTIVE" | "ARCHIVED";
export type TattooCaseStatus = "OPEN" | "ARCHIVED";

export class InvalidCustomerCaseInputError extends Error {
  readonly code = "INVALID_CUSTOMER_CASE_INPUT";

  constructor(readonly field: "artistProfileId" | "bodyArea" | "customerId" | "email" | "id" | "name" | "phone" | "size" | "status" | "summary") {
    super(`Invalid customer or tattoo case input: ${field}`);
    this.name = "InvalidCustomerCaseInputError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export function normalizeCustomerName(value: string): string {
  return normalizeRequiredText("name", value, 120);
}

export function normalizeTattooSummary(value: string): string {
  return normalizeRequiredText("summary", value, 500);
}

export function normalizeBodyArea(value: string | undefined): string | null {
  return normalizeOptionalText("bodyArea", value, 120);
}

export function normalizeTattooSize(value: string | undefined): string | null {
  return normalizeOptionalText("size", value, 120);
}

export function normalizeCustomerEmail(value: string | undefined): string | null {
  const normalized = normalizeOptionalText("email", value, 254)?.toLowerCase() ?? null;
  if (normalized !== null && !EMAIL_PATTERN.test(normalized)) {
    throw new InvalidCustomerCaseInputError("email");
  }
  return normalized;
}

export function normalizeCustomerPhone(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  const normalized = value.normalize("NFKC").trim().replace(/[\s()-]/g, "");
  if (!PHONE_PATTERN.test(normalized)) throw new InvalidCustomerCaseInputError("phone");
  return normalized;
}

export function normalizeResourceId(field: "artistProfileId" | "customerId" | "id", value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new InvalidCustomerCaseInputError(field);
  return normalized;
}

export function validateCustomerStatus(value: string): CustomerStatus {
  if (value !== "ACTIVE" && value !== "ARCHIVED") throw new InvalidCustomerCaseInputError("status");
  return value;
}

export function validateTattooCaseStatus(value: string): TattooCaseStatus {
  if (value !== "OPEN" && value !== "ARCHIVED") throw new InvalidCustomerCaseInputError("status");
  return value;
}

function normalizeRequiredText(field: "name" | "summary", value: string, maximum: number): string {
  const normalized = normalizeText(value);
  if (normalized.length === 0 || normalized.length > maximum || containsControlCharacter(normalized)) {
    throw new InvalidCustomerCaseInputError(field);
  }
  return normalized;
}

function normalizeOptionalText(field: "bodyArea" | "email" | "size", value: string | undefined, maximum: number): string | null {
  if (value === undefined) return null;
  const normalized = normalizeText(value);
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || containsControlCharacter(normalized)) {
    throw new InvalidCustomerCaseInputError(field);
  }
  return normalized;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
