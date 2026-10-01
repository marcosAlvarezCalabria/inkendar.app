// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import type { ConversationMessage, ConversationPage, ConversationThread, Customer, TattooCase } from "@inkendar/application";
import {
  ConversationActivity,
  ConversationImage,
  ConversationMessages,
  ConversationUnavailablePage,
  OwnerConversationsView,
  type OwnerConversationsData,
} from "./routes/owner-conversations.js";

const customers = [{
  id: "customer-noa",
  studioId: "studio-one",
  name: "Noa Cliente Sintética",
  email: "noa@example.invalid",
  phone: "+999000000001",
  status: "ACTIVE",
}] satisfies readonly Customer[];

const cases = [{
  id: "case-botanical",
  studioId: "studio-one",
  customerId: "customer-noa",
  summary: "Serpiente botánica en antebrazo",
  bodyArea: "Antebrazo",
  size: "18 cm",
  artistProfileId: null,
  status: "OPEN",
}] satisfies readonly TattooCase[];

const conversations = {
  items: [
    {
      id: "42",
      inboxId: "7",
      status: "open",
      channel: "instagram",
      contactName: "Noa Contacto",
      unreadCount: 3,
      lastActivityAt: "2026-09-14T10:00:00.000Z",
      canReply: true,
      link: {
        id: "link-42",
        studioId: "studio-one",
        externalAccountId: "3",
        externalInboxId: "7",
        externalConversationId: "42",
        customerId: "customer-noa",
        tattooCaseId: "case-botanical",
        lastExternalMessageId: "84",
        lastActivityAt: "2026-09-14T10:00:00.000Z",
      },
    },
    {
      id: "43",
      inboxId: "8",
      status: "pending",
      channel: "web",
      contactName: "Álex Web",
      unreadCount: 0,
      lastActivityAt: "2026-09-13T18:25:00+02:00",
      canReply: true,
      link: null,
    },
    {
      id: "44",
      inboxId: "9",
      status: "resolved",
      channel: "facebook",
      contactName: "Iker Facebook",
      unreadCount: 1,
      lastActivityAt: "2026-09-12T08:05:00.000Z",
      canReply: false,
      link: null,
    },
  ],
  page: 2,
  pageSize: 25,
  totalCount: 76,
  previousPage: 1,
  nextPage: 3,
} satisfies ConversationPage;

const messages = [
  { id: "84", direction: "incoming", content: "Mira esta referencia", createdAt: "2026-09-14T10:00:00.000Z", attachments: [{ id: "6", kind: "image" }] },
  { id: "85", direction: "outgoing", content: "La revisamos en el estudio.", createdAt: "2026-09-14T10:01:00.000Z" },
  { id: "86", direction: "incoming", content: "", createdAt: "2026-09-14T10:02:00.000Z", attachments: [{ kind: "unsupported" }] },
] satisfies readonly ConversationMessage[];

const thread = { id: "42", inboxId: "7", canReply: true, messages, before: "80" } satisfies ConversationThread;

function data(overrides: Partial<OwnerConversationsData> = {}): OwnerConversationsData {
  return { conversations, customers, cases, thread, idempotencyKey: "91000000-0000-4000-8000-000000000001", ...overrides };
}

function render(element: React.ReactNode): string {
  const router = createMemoryRouter([{ path: "/app/owner/conversations", element }], { initialEntries: ["/app/owner/conversations?conversation=42"] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("owner conversations view", () => {
  it("renders the normalized last activity required by the inbox contract", () => {
    const timestamp = "2026-09-14T10:00:00.000Z";

    const html = renderToStaticMarkup(<ConversationActivity at={timestamp} />);

    expect(html).toContain("Última actividad");
    expect(html).toContain(`dateTime="${timestamp}"`);
    expect(html).toContain("14 sept 2026, 10:00 UTC");
  });

  it("renders image captions, safe same-origin sources and accessible unsupported placeholders", () => {
    const html = renderToStaticMarkup(<ConversationMessages conversationId="42" messages={[
      { id: "84", direction: "incoming", content: "Mira esto", createdAt: "2026-09-14T10:00:00.000Z", attachments: [{ id: "6", kind: "image" }] },
      { id: "85", direction: "incoming", content: "", createdAt: "2026-09-14T10:01:00.000Z", attachments: [{ kind: "unsupported" }] },
    ]} />);

    expect(html).toContain("Mira esto");
    expect(html).toContain('src="/app/owner/conversations/42/messages/84/attachments/6"');
    expect(html).toContain('alt="Imagen adjunta del cliente"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Adjunto no disponible");
    expect(html).not.toContain("chat.example.test");
    expect(html).not.toContain("href=");
  });

  it("renders a dense inbox with permitted channels, human states, unread activity and resolved links", () => {
    const html = render(<OwnerConversationsView data={data({ thread: null, idempotencyKey: null })} />);

    expect(html).toContain("Noa Contacto");
    expect(html).toContain("Instagram");
    expect(html).toContain("Abierta");
    expect(html).toContain("3 sin leer");
    expect(html).toContain("Noa Cliente Sintética");
    expect(html).toContain("Serpiente botánica en antebrazo");
    expect(html).toContain("Web");
    expect(html).toContain("Pendiente");
    expect(html).toContain("Facebook");
    expect(html).toContain("Resuelta");
    expect(html).toContain("Página 2 de 4");
    expect(html).toContain("76 conversaciones");
    expect(html).not.toMatch(/(WhatsApp|Chatwoot|proveedor interno)/iu);
  });

  it("distinguishes an empty inbox from provider unavailability", () => {
    const empty = { items: [], page: 1, pageSize: 25, totalCount: 0, previousPage: null, nextPage: null } satisfies ConversationPage;
    const html = render(<OwnerConversationsView data={data({ conversations: empty, thread: null, idempotencyKey: null })} />);

    expect(html).toContain("Todavía no hay conversaciones");
    expect(html).toContain("Los nuevos mensajes aparecerán aquí");
    expect(html).not.toContain("temporalmente no disponible");
  });

  it("gives provider failure its own safe recovery state", () => {
    const html = renderToStaticMarkup(<ConversationUnavailablePage />);

    expect(html).toContain("Conversaciones no disponibles");
    expect(html).toContain("no puede cargarse temporalmente");
    expect(html).toContain('href="/app/owner/conversations"');
    expect(html).toContain("Reintentar carga");
    expect(html).not.toContain("Todavía no hay conversaciones");
  });

  it("keeps selected identity and status visible around the semantic Cliente/Estudio thread", () => {
    const html = render(<OwnerConversationsView data={data()} />);

    expect(html).toContain("Conversación con Noa Contacto");
    expect(html).toContain("Abierta");
    expect(html).toContain("Cliente");
    expect(html).toContain("Estudio");
    expect(html).toContain("Mira esta referencia");
    expect(html).toContain("Cargar mensajes anteriores");
    expect(html).toContain('name="intent" value="link"');
    expect(html).toContain('name="customerId"');
    expect(html).toContain('name="tattooCaseId"');
    expect(html).toContain('name="intent" value="reply"');
    expect(html).toContain('name="idempotencyKey" value="91000000-0000-4000-8000-000000000001"');
  });

  it("blocks and names only the submitted mutation while preserving the other action", () => {
    const replyPending = render(<OwnerConversationsView data={data()} pending={{ intent: "reply", conversationId: "42" }} />);
    expect(replyPending).toMatch(/value="link"[\s\S]*>Guardar vínculo</u);
    expect(replyPending).toMatch(/value="reply"[\s\S]*aria-busy="true"[\s\S]*Enviando respuesta…/u);
    expect(replyPending.match(/aria-busy="true"/gu)).toHaveLength(1);

    const linkPending = render(<OwnerConversationsView data={data()} pending={{ intent: "link", conversationId: "42" }} />);
    expect(linkPending).toMatch(/value="link"[\s\S]*aria-busy="true"[\s\S]*Guardando vínculo…/u);
    expect(linkPending).toMatch(/value="reply"[\s\S]*>Enviar respuesta</u);
    expect(linkPending.match(/aria-busy="true"/gu)).toHaveLength(1);

    const blocked = render(<OwnerConversationsView data={data()} actionResult={{ error: "No se pudo confirmar el envío.", blocked: true }} />);
    expect(blocked).toContain("No envíes otra respuesta todavía");
    expect(blocked).toMatch(/value="link"[\s\S]*>Guardar vínculo</u);
    expect(blocked).toMatch(/value="reply"[\s\S]*disabled=""/u);
  });

  it("turns a failed image load into the same accessible unavailable attachment state", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<ConversationImage source="/app/owner/conversations/42/messages/84/attachments/6" />));
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    await act(async () => image?.dispatchEvent(new Event("error")));
    expect(container.textContent).toContain("Adjunto no disponible");
    expect(container.querySelector("a")).toBeNull();
    root.unmount();
  });
});
