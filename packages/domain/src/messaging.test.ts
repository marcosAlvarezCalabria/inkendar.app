import { describe, expect, it } from "vitest";

import { InvalidMessagingInputError, normalizeConversationId, normalizeConversationPage, normalizeIdempotencyKey, normalizeMessageBefore, normalizeReplyText } from "./messaging.js";

describe("messaging input", () => {
  it("normalizes provider identifiers and a UUID idempotency key", () => {
    expect(normalizeConversationId(" 42 ")).toBe("42");
    expect(normalizeIdempotencyKey(" 90000000-0000-4000-8000-000000000001 ")).toBe("90000000-0000-4000-8000-000000000001");
  });

  it.each(["", "0", "-1", "1.5", "abc"])("rejects invalid conversation id %j", (value) => {
    expect(() => normalizeConversationId(value)).toThrow(InvalidMessagingInputError);
  });

  it("normalizes reply text without flattening intentional lines", () => {
    expect(normalizeReplyText("  Hola\r\n\r\n  ¿Qué tal?  ")).toBe("Hola\n\n  ¿Qué tal?");
  });

  it.each(["", "   ", "hola\u0000", "x".repeat(4001)])("rejects empty, control or oversized replies", (value) => {
    expect(() => normalizeReplyText(value)).toThrow(InvalidMessagingInputError);
  });

  it("rejects a non UUID idempotency key", () => {
    expect(() => normalizeIdempotencyKey("retry-me")).toThrow(InvalidMessagingInputError);
  });

  it("accepts only conversation pages from 1 through 1000", () => {
    expect(normalizeConversationPage(null)).toBe(1);
    expect(normalizeConversationPage("1000")).toBe(1000);
    for (const value of ["0", "1001", "1.5", "+1", " 1"]) {
      expect(() => normalizeConversationPage(value)).toThrow(InvalidMessagingInputError);
    }
  });

  it("keeps an older-message cursor opaque after validating it is positive", () => {
    expect(normalizeMessageBefore(null)).toBeUndefined();
    expect(normalizeMessageBefore("900719925474099312345")).toBe("900719925474099312345");
    for (const value of ["", "0", "-1", "1.5", "01"]) {
      expect(() => normalizeMessageBefore(value)).toThrow(InvalidMessagingInputError);
    }
  });
});
