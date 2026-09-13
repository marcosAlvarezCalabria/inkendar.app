import { describe, expect, it } from "vitest";

import {
  InvalidCustomerCaseInputError,
  normalizeBodyArea,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
  normalizeTattooSummary,
} from "./customer-cases.js";

describe("customer and tattoo case values", () => {
  it("normalizes required names and summaries", () => {
    expect(normalizeCustomerName("  María   López ")).toBe("María López");
    expect(normalizeTattooSummary("  Floral   en negro ")).toBe("Floral en negro");
  });

  it("normalizes optional contact and descriptive fields", () => {
    expect(normalizeCustomerEmail("  CLIENTE@Example.COM ")).toBe("cliente@example.com");
    expect(normalizeCustomerPhone(" +34 (600) 123-456 ")).toBe("+34600123456");
    expect(normalizeBodyArea("   Antebrazo   derecho ")).toBe("Antebrazo derecho");
    expect(normalizeBodyArea("   ")).toBeNull();
    expect(normalizeCustomerEmail(" ")).toBeNull();
    expect(normalizeCustomerPhone(" ")).toBeNull();
  });

  it.each([
    () => normalizeCustomerName(" "),
    () => normalizeTattooSummary("\u0000private"),
    () => normalizeCustomerEmail("not-an-email"),
    () => normalizeCustomerPhone("600 123"),
  ])("rejects values outside the contract without echoing them", (operation) => {
    expect(operation).toThrow(InvalidCustomerCaseInputError);
    try {
      operation();
    } catch (error) {
      expect(String(error)).not.toContain("private");
      expect(String(error)).not.toContain("not-an-email");
      expect(String(error)).not.toContain("600 123");
    }
  });
});
