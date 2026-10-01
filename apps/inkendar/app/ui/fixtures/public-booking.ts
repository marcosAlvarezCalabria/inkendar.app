import type { PublicBookingOfferView, PublicFreeChoiceAvailabilityView } from "@inkendar/application";

export const openOfferAtDayBoundary = {
  state: "OPEN",
  expiresAt: "2026-01-01T03:00:00.000Z",
  artistDisplayName: "Artista de prueba",
  timeZone: "America/Los_Angeles",
  options: [
    { selector: "a0000000-0000-4000-8000-000000000001", startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z" },
    { selector: "a0000000-0000-4000-8000-000000000002", startUtc: "2026-01-02T00:30:00.000Z", endUtc: "2026-01-02T01:30:00.000Z" },
    { selector: "a0000000-0000-4000-8000-000000000003", startUtc: "2026-01-03T00:30:00.000Z", endUtc: "2026-01-03T01:30:00.000Z" },
  ],
} satisfies PublicBookingOfferView;

export const pendingOffer = {
  state: "SELECTION_PENDING_CONFIRMATION",
  expiresAt: "2026-01-01T03:00:00.000Z",
  artistDisplayName: "Artista de prueba",
  timeZone: null,
  options: [{ startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z" }],
} satisfies PublicBookingOfferView;

export const confirmedOffer = {
  state: "CONFIRMED",
  expiresAt: "2026-01-01T03:00:00.000Z",
  confirmedAt: "2026-01-01T00:10:00.000Z",
  artistDisplayName: "Artista de prueba",
  timeZone: "Europe/Dublin",
  options: [{ startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z" }],
} satisfies PublicBookingOfferView;

export const openAvailabilityAtDayBoundary = {
  state: "OPEN",
  rangeStart: "2026-01-01T00:00:00.000Z",
  rangeEnd: "2026-01-04T00:00:00.000Z",
  durationMinutes: 60,
  expiresAt: "2026-01-01T03:00:00.000Z",
  artistDisplayName: "Artista de prueba",
  timeZone: "America/Los_Angeles",
  slots: [
    { selector: "ab".repeat(32), startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z", startLocal: "2025-12-31T16:30", endLocal: "2025-12-31T17:30" },
    { selector: "bc".repeat(32), startUtc: "2026-01-02T00:30:00.000Z", endUtc: "2026-01-02T01:30:00.000Z", startLocal: "2026-01-01T16:30", endLocal: "2026-01-01T17:30" },
    { selector: "cd".repeat(32), startUtc: "2026-01-03T00:30:00.000Z", endUtc: "2026-01-03T01:30:00.000Z", startLocal: "2026-01-02T16:30", endLocal: "2026-01-02T17:30" },
  ],
} satisfies PublicFreeChoiceAvailabilityView;

export const emptyAvailability = {
  ...openAvailabilityAtDayBoundary,
  slots: [],
} satisfies PublicFreeChoiceAvailabilityView;

export const availabilityStates = [
  { state: "PENDING_OWNER_APPROVAL", selectedSlot: { startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z" } },
  { state: "APPROVING" },
  { state: "CONFIRMED", selectedSlot: { startUtc: "2026-01-01T00:30:00.000Z", endUtc: "2026-01-01T01:30:00.000Z" } },
  { state: "REJECTED" },
  { state: "EXPIRED" },
] satisfies readonly PublicFreeChoiceAvailabilityView[];
