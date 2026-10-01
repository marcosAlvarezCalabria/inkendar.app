import type { BookingOfferManagement } from "@inkendar/application";

export const populatedOwnerOffers = {
  expiryHours: 24,
  cases: [
    { id: "case-botanical", summary: "Serpiente botánica en antebrazo", artistProfileId: "artist-luz" },
    { id: "case-linework", summary: "Composición geométrica de línea fina", artistProfileId: null },
  ],
  artists: [
    { id: "artist-luz", displayName: "Luz Artista" },
    { id: "artist-rai", displayName: "Rai Artista" },
  ],
  offers: [
    {
      id: "offer-open", studioId: "studio-synthetic", tattooCaseId: "case-botanical", artistProfileId: "artist-luz", status: "OPEN",
      expiresAt: "2026-10-02T09:30:00.000Z", createdAt: "2026-10-01T09:30:00.000Z",
      options: [
        { id: "option-held", status: "HELD", startUtc: "2026-10-08T09:00:00.000Z", endUtc: "2026-10-08T10:30:00.000Z" },
        { id: "option-released", status: "RELEASED", startUtc: "2026-10-09T13:00:00.000Z", endUtc: "2026-10-09T14:30:00.000Z" },
      ],
    },
    {
      id: "offer-selected", studioId: "studio-synthetic", tattooCaseId: "case-linework", artistProfileId: "artist-rai", status: "SELECTED_PENDING_CONFIRMATION",
      expiresAt: "2026-10-03T18:00:00.000Z", createdAt: "2026-10-01T10:00:00.000Z",
      options: [{ id: "option-selected", status: "SELECTED", startUtc: "2026-10-10T22:30:00.000Z", endUtc: "2026-10-11T00:00:00.000Z" }],
    },
    {
      id: "offer-confirmed", studioId: "studio-synthetic", tattooCaseId: "case-botanical", artistProfileId: "artist-luz", status: "CONFIRMED",
      expiresAt: "2026-10-01T12:00:00.000Z", createdAt: "2026-09-30T12:00:00.000Z",
      options: [{ id: "option-confirmed", status: "CONFIRMED", startUtc: "2026-10-12T11:00:00.000Z", endUtc: "2026-10-12T12:30:00.000Z" }],
    },
    {
      id: "offer-expired", studioId: "studio-synthetic", tattooCaseId: "case-linework", artistProfileId: "artist-rai", status: "EXPIRED",
      expiresAt: "2026-09-30T08:00:00.000Z", createdAt: "2026-09-29T08:00:00.000Z",
      options: [{ id: "option-expired-released", status: "RELEASED", startUtc: "2026-10-04T08:00:00.000Z", endUtc: "2026-10-04T09:00:00.000Z" }],
    },
  ],
} satisfies BookingOfferManagement;

export const emptyOwnerOffers = { expiryHours: 24, cases: [], artists: [], offers: [] } satisfies BookingOfferManagement;

export const issuedOwnerOfferAccess = {
  accessUrl: `https://app.example.invalid/offers/${"A".repeat(43)}`,
  expiresAt: "2026-10-02T09:30:00.000Z",
} as const;

type OwnerOfferFixtureScenario = Readonly<{
  id: string;
  description: string;
  viewport: "compact" | "mobile" | "tablet" | "desktop";
  view: BookingOfferManagement;
  actionResult?: typeof issuedOwnerOfferAccess;
}>;

export const ownerOfferFixtureScenarios = [
  { id: "owner-offers-compact", description: "Booking OWNER poblado a 320 px", viewport: "compact", view: populatedOwnerOffers },
  { id: "owner-offers-sensitive-link", description: "Enlace sensible recién emitido en móvil", viewport: "mobile", view: populatedOwnerOffers, actionResult: issuedOwnerOfferAccess },
  { id: "owner-offers-empty", description: "Booking OWNER sin precondiciones", viewport: "tablet", view: emptyOwnerOffers },
  { id: "owner-offers-all-states", description: "Todos los estados de ofertas y opciones", viewport: "desktop", view: populatedOwnerOffers },
] satisfies readonly OwnerOfferFixtureScenario[];
