// @vitest-environment node
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerInkendarGalleryElement } from "./inkendar-gallery.js";

const studioSlug = "10000000-0000-4000-8000-000000000001";
const otherSlug = "10000000-0000-4000-8000-000000000002";
const feed = {
  studio_public_slug: studioSlug,
  updated_at: "2026-09-17T10:00:00.000Z",
  gallery_images: [image("general", "Pieza general", 1)],
  artists: [{
    artist_public_slug: "20000000-0000-4000-8000-000000000001",
    display_name: "Ana",
    portfolio_images: [image("portfolio", "Pieza de Ana", 2)],
  }],
};

describe("inkendar-gallery", () => {
  let window: Window;

  beforeEach(() => {
    window = new Window({ url: "https://client.example/page" });
    installBrowserGlobals(window);
  });

  afterEach(() => {
    window.close();
    vi.restoreAllMocks();
    removeBrowserGlobals();
  });

  it("registers idempotently and is safe when browser globals do not exist", () => {
    removeBrowserGlobals();
    expect(() => registerInkendarGalleryElement()).not.toThrow();
    installBrowserGlobals(window);

    registerInkendarGalleryElement();
    const first = window.customElements.get("inkendar-gallery");
    registerInkendarGalleryElement();

    expect(first).toBeTypeOf("function");
    expect(window.customElements.get("inkendar-gallery")).toBe(first);
  });

  it("loads from the asset origin and renders ordered responsive images", async () => {
    const fetch = vi.fn().mockResolvedValue(new window.Response(JSON.stringify(feed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    registerInkendarGalleryElement("https://app.inkendar.example/inkendar-gallery.js");

    const element = window.document.createElement("inkendar-gallery");
    element.setAttribute("studio-slug", studioSlug);
    window.document.body.append(element);
    await settled();

    const [requestedUrl, requestInit] = fetch.mock.calls[0]!;
    expect(String(requestedUrl)).toBe(`https://app.inkendar.example/api/public/studios/${studioSlug}/gallery`);
    expect(requestInit).toMatchObject({ method: "GET", mode: "cors", credentials: "omit", redirect: "error" });
    expect(requestInit.signal).toBeInstanceOf(window.AbortSignal);
    const shadow = element.shadowRoot!;
    expect([...shadow.querySelectorAll("h2, h3")].map((heading) => heading.textContent)).toEqual(["Galería", "Ana"]);
    expect([...shadow.querySelectorAll("img")].map((img) => img.alt)).toEqual(["Pieza general", "Pieza de Ana"]);
    for (const img of shadow.querySelectorAll("img")) {
      expect(img.loading).toBe("lazy");
      expect(img.decoding).toBe("async");
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(img.srcset).toContain("thumb.webp");
      expect(img.srcset).toContain("display.webp");
    }
    expect(shadow.querySelector("[role=status]")?.textContent).toContain("Galería cargada");
  });

  it("shows empty and generic retryable error states", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new window.Response(JSON.stringify({ ...feed, gallery_images: [], artists: [] }), { status: 200 }))
      .mockResolvedValueOnce(new window.Response("provider detail", { status: 503 }))
      .mockResolvedValueOnce(new window.Response(JSON.stringify({ ...feed, studio_public_slug: otherSlug }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    registerInkendarGalleryElement();
    const element = window.document.createElement("inkendar-gallery");
    element.setAttribute("studio-slug", studioSlug);
    element.setAttribute("api-origin", "https://app.inkendar.example");
    window.document.body.append(element);
    await settled();
    expect(element.shadowRoot?.textContent).toContain("Aún no hay imágenes publicadas");

    element.setAttribute("studio-slug", otherSlug);
    await settled();
    expect(element.shadowRoot?.textContent).toContain("No se pudo cargar la galería");
    expect(element.shadowRoot?.textContent).not.toContain("provider detail");
    const retry = element.shadowRoot?.querySelector("button");
    expect(retry?.textContent).toContain("Reintentar");
    retry?.click();
    await settled();
    expect(element.shadowRoot?.querySelectorAll("img")).toHaveLength(2);
  });

  it("aborts stale requests on attribute changes and disconnection", async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({ signal: init?.signal as AbortSignal, resolve });
    }));
    vi.stubGlobal("fetch", fetch);
    registerInkendarGalleryElement();
    const element = window.document.createElement("inkendar-gallery");
    element.setAttribute("studio-slug", studioSlug);
    element.setAttribute("api-origin", "https://app.inkendar.example");
    window.document.body.append(element);
    await settled();

    element.setAttribute("studio-slug", otherSlug);
    await settled();
    expect(pending[0]?.signal.aborted).toBe(true);
    pending[0]?.resolve(new window.Response(JSON.stringify(feed), { status: 200 }) as unknown as Response);
    expect(element.shadowRoot?.textContent).not.toContain("Pieza general");

    element.remove();
    expect(pending[1]?.signal.aborted).toBe(true);
  });

  it("rejects invalid input and unsafe feed URLs without leaking remote content", async () => {
    const fetch = vi.fn().mockResolvedValue(new window.Response(JSON.stringify({
      ...feed,
      gallery_images: [image("general", "<img src=x onerror=alert(1)>", 1, "javascript:alert(1)")],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    registerInkendarGalleryElement();
    const element = window.document.createElement("inkendar-gallery");
    element.setAttribute("studio-slug", "not-a-slug");
    element.setAttribute("api-origin", "javascript:alert(1)");
    window.document.body.append(element);
    await settled();
    expect(fetch).not.toHaveBeenCalled();
    expect(element.shadowRoot?.textContent).toContain("configuración");

    element.setAttribute("studio-slug", studioSlug);
    element.setAttribute("api-origin", "https://app.inkendar.example");
    await settled();
    expect(element.shadowRoot?.textContent).toContain("No se pudo cargar la galería");
    expect(element.shadowRoot?.innerHTML).not.toContain("onerror");
  });
});

function image(id: string, altText: string, position: number, displayUrl = `https://cdn.example/${id}/display.webp`) {
  return {
    public_id: `30000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    image_variants: {
      display: { url: displayUrl, width: 1200, height: 800, mime_type: "image/webp" },
      thumb: { url: `https://cdn.example/${id}/thumb.webp`, width: 480, height: 320, mime_type: "image/webp" },
    },
    alt_text: altText,
    position,
    published_at: "2026-09-17T10:00:00.000Z",
  };
}

function installBrowserGlobals(window: Window): void {
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("customElements", window.customElements);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("AbortController", window.AbortController);
}

function removeBrowserGlobals(): void {
  vi.unstubAllGlobals();
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
