/** Presentation-only ARTIST agenda fixtures for development and tests. */
import type { ArtistAgendaItem } from "@inkendar/application";

import type { FixtureScenario } from "./ui-foundation.fixtures.js";

export type ArtistAgendaFixtureView = Readonly<{
  displayName: string;
  appointments: readonly ArtistAgendaItem[];
}>;

const populatedAppointments = [
  {
    startUtc: "2026-10-03T08:00:00.000Z",
    endUtc: "2026-10-03T10:30:00.000Z",
    customerDisplayName: "Vera Cliente Sintética",
    caseSummary: "Composición botánica de línea fina",
    bodyArea: "Antebrazo",
    size: "Mediana",
    timeZone: "Europe/Madrid",
  },
  {
    startUtc: "2026-10-03T13:00:00.000Z",
    endUtc: "2026-10-03T14:30:00.000Z",
    customerDisplayName: "Gael Cliente Sintético",
    caseSummary: "Ornamento geométrico en tinta negra",
    bodyArea: null,
    size: "Pequeña",
    timeZone: "Europe/Madrid",
  },
] as const satisfies readonly ArtistAgendaItem[];

const localDayAppointments = [
  {
    startUtc: "2026-09-20T00:30:00.000Z",
    endUtc: "2026-09-20T01:30:00.000Z",
    customerDisplayName: "Luz Cliente Sintética",
    caseSummary: "Pieza floral nocturna",
    bodyArea: "Brazo",
    size: null,
    timeZone: "America/New_York",
  },
  {
    startUtc: "2026-09-20T14:00:00.000Z",
    endUtc: "2026-09-20T15:00:00.000Z",
    customerDisplayName: "Rai Cliente Sintético",
    caseSummary: "Símbolo lineal",
    bodyArea: null,
    size: "Pequeña",
    timeZone: "America/New_York",
  },
] as const satisfies readonly ArtistAgendaItem[];

const longTextAppointments = [
  {
    startUtc: "2026-11-12T09:15:00.000Z",
    endUtc: "2026-11-12T13:45:00.000Z",
    customerDisplayName: "Amaru Cliente Sintético con nombre deliberadamente extenso",
    caseSummary: "Composición panorámica de ramas, flores y formas abstractas que debe conservar una lectura clara sin provocar desbordamiento horizontal.",
    bodyArea: "Espalda completa y continuación hacia el hombro derecho",
    size: "Grande, distribuida en una sesión prolongada",
    timeZone: "Pacific/Auckland",
  },
] as const satisfies readonly ArtistAgendaItem[];

export const artistAgendaFixtureScenarios = [
  {
    id: "artist-agenda-populated-compact",
    description: "Agenda ARTIST poblada a 320 px",
    viewport: "compact",
    view: { displayName: "Nora Artista Sintética", appointments: populatedAppointments },
  },
  {
    id: "artist-agenda-local-day-mobile",
    description: "Agenda ARTIST con cambio de día entre UTC y zona local",
    viewport: "mobile",
    view: { displayName: "Iria Artista Sintética", appointments: localDayAppointments },
  },
  {
    id: "artist-agenda-long-tablet",
    description: "Agenda ARTIST con contenido largo",
    viewport: "tablet",
    view: { displayName: "Teo Artista Sintético", appointments: longTextAppointments },
  },
  {
    id: "artist-agenda-empty-desktop",
    description: "Agenda ARTIST vacía y tranquila",
    viewport: "desktop",
    view: { displayName: "Uma Artista Sintética", appointments: [] },
  },
] as const satisfies readonly FixtureScenario<ArtistAgendaFixtureView>[];
