import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationActivity, ConversationMessages } from "./routes/owner-conversations.js";

describe("owner conversations view", () => {
  it("renders the normalized last activity required by the inbox contract", () => {
    const timestamp = "2026-09-14T10:00:00.000Z";

    const html = renderToStaticMarkup(<ConversationActivity at={timestamp} />);

    expect(html).toContain("Última actividad");
    expect(html).toContain(`dateTime="${timestamp}"`);
    expect(html).toContain(timestamp);
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
});
