import { describe, expect, it } from "vitest";
import { InvalidAvailabilityInputError, validateFreeChoiceAvailabilityAccess } from "./availability.js";

describe("free-choice availability access",()=>{
  it("accepts only a future bounded range, duration and visible expiry",()=>{
    expect(()=>validateFreeChoiceAvailabilityAccess({rangeStart:"2026-09-20T09:00:00.000Z",rangeEnd:"2026-09-27T09:00:00.000Z",durationMinutes:60,expiresAt:"2026-09-21T09:00:00.000Z",nowUtc:"2026-09-20T08:00:00.000Z"})).not.toThrow();
    expect(()=>validateFreeChoiceAvailabilityAccess({rangeStart:"2026-09-20T07:00:00.000Z",rangeEnd:"2026-09-21T09:00:00.000Z",durationMinutes:60,expiresAt:"2026-09-21T09:00:00.000Z",nowUtc:"2026-09-20T08:00:00.000Z"})).toThrow(InvalidAvailabilityInputError);
    expect(()=>validateFreeChoiceAvailabilityAccess({rangeStart:"2026-09-20T09:00:00.000Z",rangeEnd:"2026-10-22T09:00:00.000Z",durationMinutes:60,expiresAt:"2026-09-21T09:00:00.000Z",nowUtc:"2026-09-20T08:00:00.000Z"})).toThrow(InvalidAvailabilityInputError);
    expect(()=>validateFreeChoiceAvailabilityAccess({rangeStart:"2026-09-20T09:00:00.000Z",rangeEnd:"2026-09-21T09:00:00.000Z",durationMinutes:60,expiresAt:"2026-09-22T09:00:00.000Z",nowUtc:"2026-09-20T08:00:00.000Z"})).toThrow(InvalidAvailabilityInputError);
  });
});
