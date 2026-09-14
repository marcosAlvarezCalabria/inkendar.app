import { describe, expect, it } from "vitest";

import {
  InvalidConversationInputError,
  normalizeConversationReply,
  normalizeExternalConversationId,
} from "./conversations.js";

describe("conversation values", () => {
  it("normalizes opaque positive provider identifiers", () => {
    expect(normalizeExternalConversationId(" 0042 ")).toBe("42");
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
    try {
      normalizeConversationReply(privateText);
    } catch (error) {
      expect(String(error)).not.toContain("private");
    }
  });
});
