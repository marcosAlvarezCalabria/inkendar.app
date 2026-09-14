export class InvalidMessagingInputError extends Error {
  readonly code = "INVALID_MESSAGING_INPUT";
  constructor(readonly field: "conversationId" | "idempotencyKey" | "reply" | "page" | "before") {
    super(`Invalid messaging input: ${field}`);
    this.name = "InvalidMessagingInputError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export function normalizeConversationId(value: string): string {
  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) throw new InvalidMessagingInputError("conversationId");
  return normalized;
}

export function normalizeConversationPage(value: string | null | undefined): number {
  if (value === null || value === undefined) return 1;
  if (!/^(?:[1-9][0-9]{0,2}|1000)$/.test(value)) throw new InvalidMessagingInputError("page");
  return Number(value);
}

export function normalizeMessageBefore(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!POSITIVE_INTEGER_PATTERN.test(value)) throw new InvalidMessagingInputError("before");
  return value;
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new InvalidMessagingInputError("idempotencyKey");
  return normalized;
}

export function normalizeReplyText(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0 || normalized.length > 4000 || containsForbiddenControl(normalized)) {
    throw new InvalidMessagingInputError("reply");
  }
  return normalized;
}

function containsForbiddenControl(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && ((point <= 31 && point !== 10) || point === 127);
  });
}
