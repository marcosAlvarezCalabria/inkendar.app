/** Presentation-only projections for the canonical frontend MVP review catalog. */
import type {
  ArtistOption,
  ConversationMessage,
  ConversationPage,
  ConversationThread,
  Customer,
  TattooCase,
} from "@inkendar/application";

import type { CalendarView } from "../../routes/owner-calendars.js";
import type { OwnerCasesData } from "../../routes/owner-cases.js";
import type { OwnerConversationsData } from "../../routes/owner-conversations.js";

export const reviewCustomers = [
  {
    id: "customer-noa",
    studioId: "studio-synthetic",
    name: "Noa Cliente Sintética",
    email: "noa@example.invalid",
    phone: "+999000000001",
    status: "ACTIVE",
  },
  {
    id: "customer-iker",
    studioId: "studio-synthetic",
    name: "Iker Cliente Archivado",
    email: null,
    phone: null,
    status: "ARCHIVED",
  },
] satisfies readonly Customer[];

const reviewArtists = [
  { id: "artist-luz", displayName: "Luz Artista Sintética" },
] satisfies readonly ArtistOption[];

const reviewCases = [
  {
    id: "case-botanical",
    studioId: "studio-synthetic",
    customerId: "customer-noa",
    summary: "Serpiente botánica en antebrazo",
    bodyArea: "Antebrazo",
    size: "18 cm",
    artistProfileId: "artist-luz",
    status: "OPEN",
  },
] satisfies readonly TattooCase[];

export const reviewOwnerCases = {
  cases: reviewCases,
  customers: reviewCustomers,
  artists: reviewArtists,
} satisfies OwnerCasesData;

const reviewConversationPage = {
  items: [{
    id: "conversation-42",
    inboxId: "inbox-7",
    status: "open",
    channel: "instagram",
    contactName: "Noa Contacto Sintético",
    unreadCount: 3,
    lastActivityAt: "2026-10-01T10:00:00.000Z",
    canReply: true,
    link: null,
  }],
  page: 1,
  pageSize: 25,
  totalCount: 1,
  previousPage: null,
  nextPage: null,
} satisfies ConversationPage;

const reviewMessages = [
  { id: "message-1", direction: "incoming", content: "Quiero consultar una pieza botánica.", createdAt: "2026-10-01T10:00:00.000Z" },
  { id: "message-2", direction: "outgoing", content: "Revisamos tu idea y te respondemos desde el estudio.", createdAt: "2026-10-01T10:05:00.000Z" },
] satisfies readonly ConversationMessage[];

const reviewThread = {
  id: "conversation-42",
  inboxId: "inbox-7",
  canReply: true,
  messages: reviewMessages,
  before: null,
} satisfies ConversationThread;

export const reviewOwnerConversations = {
  conversations: reviewConversationPage,
  customers: reviewCustomers,
  cases: reviewCases,
  thread: reviewThread,
  idempotencyKey: "91000000-0000-4000-8000-000000000001",
} satisfies OwnerConversationsData;

export const reviewOwnerCalendar = {
  connectionStatus: "ACTIVE",
  calendars: [],
  artists: [{ id: "artist-luz", displayName: "Luz Artista Sintética", calendarId: null }],
  availabilityByArtist: { "artist-luz": null },
  freeChoice: {
    status: "available",
    data: {
      cases: [{ id: "case-botanical", summary: "Serpiente botánica en antebrazo", artistProfileId: "artist-luz" }],
      pendingRequests: [{
        id: "request-synthetic",
        status: "PENDING_OWNER_APPROVAL",
        customerName: "Noa Cliente Sintética",
        caseSummary: "Serpiente botánica en antebrazo",
        artistDisplayName: "Luz Artista Sintética",
        startUtc: "2026-10-08T09:00:00.000Z",
        endUtc: "2026-10-08T10:30:00.000Z",
        expiresAt: "2026-10-02T09:00:00.000Z",
      }],
    },
  },
} satisfies CalendarView;
