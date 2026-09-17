import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type * as ReactRouterModule from "react-router";
import { describe, expect, it, vi } from "vitest";
import { headers, OwnerGalleryView } from "./routes/owner-gallery.js";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    Form: ({ children, ...props }: ComponentProps<"form">) => <form data-router-form="" {...props}>{children}</form>,
  };
});

describe("OwnerGalleryView mutation transport", () => {
  it("preserves same-origin context for native form posts before hydration", () => {
    const responseHeaders = new Headers(headers());

    expect(responseHeaders.get("Referrer-Policy")).toBe("same-origin");
    expect(responseHeaders.get("Cache-Control")).toBe("private, no-store");
    expect(responseHeaders.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("uses React Router enhanced forms for every gallery mutation", () => {
    const statuses = ["DRAFT", "PUBLISHING", "PUBLISHED", "RETIRING"] as const;
    const drafts = statuses.map((status, index) => ({
      thumbnailHandle: `90000000-0000-4000-8000-00000000000${index + 1}`,
      thumbnailSrc: `/app/owner/gallery/thumbnails/${index + 1}`,
      status,
      target: "GALLERY" as const,
      artistProfileId: null,
      artistDisplayName: null,
      altText: `Pieza ${index + 1}`,
      position: index + 1,
      width: 480,
      height: 320,
    }));
    const discarded = [{
      handle: "90000000-0000-4000-8000-000000000099",
      target: "GALLERY" as const,
      artistDisplayName: null,
      altText: "Pieza recuperable",
      discardedAt: "2026-09-17T10:00:00.000Z",
    }];
    const html = renderToStaticMarkup(
      <MemoryRouter><OwnerGalleryView data={{ artists: [], drafts, discarded }} /></MemoryRouter>,
    );
    const intents = [...html.matchAll(/name="intent" value="([A-Z_]+)"/gu)].map((match) => match[1]);
    const expectedIntents = ["CREATE_DRAFT", "UPDATE", "MOVE_UP", "MOVE_DOWN", "DISCARD", "PUBLISH", "RETIRE", "RESTORE"];

    expect(new Set(intents)).toEqual(new Set(expectedIntents));
    expect(html.match(/<form\b/gu)).toHaveLength(10);
    expect(html.match(/data-router-form=""/gu)).toHaveLength(10);
  });
});
