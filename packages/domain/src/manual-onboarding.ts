export type MembershipRole = "OWNER" | "ARTIST";

export class InvalidOnboardingInputError extends Error {
  readonly code = "INVALID_ONBOARDING_INPUT";

  constructor(readonly field: "command" | "displayName" | "email" | "password" | "studioId" | "studioName") {
    super(`Invalid onboarding input: ${field}`);
    this.name = "InvalidOnboardingInputError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePersonName(value: string): string {
  return normalizeName("displayName", value);
}

export function normalizeStudioName(value: string): string {
  return normalizeName("studioName", value);
}

function normalizeName(field: "displayName" | "studioName", value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > 120 || containsControlCharacter(normalized)) {
    throw new InvalidOnboardingInputError(field);
  }
  return normalized;
}

export function normalizeEmail(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    containsControlCharacter(normalized) ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new InvalidOnboardingInputError("email");
  }
  return normalized;
}

export function validatePassword(value: string): string {
  if (value.length < 8 || value.length > 128 || value.includes("\u0000")) {
    throw new InvalidOnboardingInputError("password");
  }
  return value;
}

export function validateStudioId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new InvalidOnboardingInputError("studioId");
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
