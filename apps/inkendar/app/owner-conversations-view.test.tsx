import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationActivity } from "./routes/owner-conversations.js";

describe("owner conversations view", () => {
  it("renders the normalized last activity required by the inbox contract", () => {
    const timestamp = "2026-09-14T10:00:00.000Z";

    const html = renderToStaticMarkup(<ConversationActivity at={timestamp} />);

    expect(html).toContain("Última actividad");
    expect(html).toContain(`dateTime="${timestamp}"`);
    expect(html).toContain(timestamp);
  });
});
