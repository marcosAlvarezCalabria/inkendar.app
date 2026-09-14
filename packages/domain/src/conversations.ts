export class InvalidConversationInputError extends Error {
  readonly code = "INVALID_CONVERSATION_INPUT";

  constructor(readonly field: "externalId" | "reply") {
    super(`Invalid conversation input: ${field}`);
    this.name = "InvalidConversationInputError";
  }
}

export function normalizeExternalConversationId(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new InvalidConversationInputError("externalId");
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new InvalidConversationInputError("externalId");
  return String(numeric);
}

export function normalizeConversationReply(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0 || normalized.length > 2_000 || hasForbiddenControlCharacter(normalized)) {
    throw new InvalidConversationInputError("reply");
  }
  return normalized;
}

function hasForbiddenControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint === 127 || (codePoint < 32 && codePoint !== 10));
  });
}
