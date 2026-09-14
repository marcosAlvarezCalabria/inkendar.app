import { describe, expect, it } from "vitest";

import {
  InvalidConversationInputError,
  normalizeConversationPage,
  normalizeConversationReply,
  normalizeExternalConversationId,
  normalizeIdempotencyKey,
  normalizeMessageBefore,
} from "./conversations.js";

describe("conversation values", () => {
  it("normalizes opaque positive provider identifiers and cursors", () => {
    expect(normalizeExternalConversationId(" 0042 ")).toBe("42");
    expect(normalizeMessageBefore(" 0084 ")).toBe("84");
    expect(normalizeMessageBefore(null)).toBeUndefined();
  });

  it("accepts only conversation pages from 1 through 1000", () => {
    expect(normalizeConversationPage(null)).toBe(1);
    expect(normalizeConversationPage("1000")).toBe(1000);
    for (const value of ["0", "1001", "1.5", "01", "x"]) {
      expect(() => normalizeConversationPage(value)).toThrow(InvalidConversationInputError);
    }
  });

  it("normalizes UUID idempotency keys", () => {
    expect(normalizeIdempotencyKey(" 90000000-0000-4000-8000-000000000001 ")).toBe("90000000-0000-4000-8000-000000000001");
    expect(() => normalizeIdempotencyKey("retry-1")).toThrow(InvalidConversationInputError);
  });

  it("normalizes a public text reply while preserving line breaks", () => {
    expect(normalizeConversationReply("  Hola\r\nMaría  ")).toBe("Hola\nMaría");
  });

  it.each(["", "0", "-1", "1.5", "9007199254740992"])('rejects invalid external id "%s"', (value) => {
    expect(() => normalizeExternalConversationId(value)).toThrow(InvalidConversationInputError);
  });

  it("rejects empty, oversized and control-character replies without echoing input", () => {
    const privateText = "private\u0000text";
    expect(() => normalizeConversationReply(" ")).toThrow(InvalidConversationInputError);
    expect(() => normalizeConversationReply("x".repeat(2_001))).toThrow(InvalidConversationInputError);
    expect(() => normalizeConversationReply(privateText)).toThrow(InvalidConversationInputError);
    try { normalizeConversationReply(privateText); } catch (error) { expect(String(error)).not.toContain("private"); }
  });
});
