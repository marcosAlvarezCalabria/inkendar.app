export type ConversationInputField = "externalId" | "reply" | "page" | "before" | "idempotencyKey";

export class InvalidConversationInputError extends Error {
  readonly code = "INVALID_CONVERSATION_INPUT";

  constructor(readonly field: ConversationInputField) {
    super(`Invalid conversation input: ${field}`);
    this.name = "InvalidConversationInputError";
  }
}

export function normalizeExternalConversationId(value: string): string {
  return normalizePositiveInteger(value, "externalId");
}

export function normalizeConversationPage(value: string | null | undefined): number {
  const normalized = value?.trim() || "1";
  const page = Number(normalized);
  if (!/^[1-9][0-9]*$/.test(normalized) || !Number.isSafeInteger(page) || page > 1_000) {
    throw new InvalidConversationInputError("page");
  }
  return page;
}

export function normalizeMessageBefore(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  return normalizePositiveInteger(value, "before");
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new InvalidConversationInputError("idempotencyKey");
  }
  return normalized;
}

export function normalizeConversationReply(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0 || normalized.length > 2_000 || hasForbiddenControlCharacter(normalized)) {
    throw new InvalidConversationInputError("reply");
  }
  return normalized;
}

function normalizePositiveInteger(value: string, field: "externalId" | "before"): string {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new InvalidConversationInputError(field);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new InvalidConversationInputError(field);
  return String(numeric);
}

function hasForbiddenControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint === 127 || (codePoint < 32 && codePoint !== 10));
  });
}
