const ELEMENT_NAME = "inkendar-gallery";
const PUBLIC_SLUG = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STYLE = `
  :host {
    --_background: var(--inkendar-gallery-background, transparent);
    --_color: var(--inkendar-gallery-color, #171717);
    --_muted: var(--inkendar-gallery-muted-color, #666);
    --_accent: var(--inkendar-gallery-accent-color, #171717);
    --_font: var(--inkendar-gallery-font-family, inherit);
    --_gap: var(--inkendar-gallery-gap, 1rem);
    --_min-item-width: var(--inkendar-gallery-min-item-width, 15rem);
    --_radius: var(--inkendar-gallery-radius, .5rem);
    display: block;
    box-sizing: border-box;
    color: var(--_color);
    background: var(--_background);
    font-family: var(--_font);
  }
  *, *::before, *::after { box-sizing: inherit; }
  section + section { margin-block-start: calc(var(--_gap) * 2); }
  h2, h3 { margin: 0 0 var(--_gap); color: inherit; font: inherit; font-weight: 650; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.25rem; }
  ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--_min-item-width)), 1fr)); gap: var(--_gap); margin: 0; padding: 0; list-style: none; }
  img { display: block; width: 100%; height: auto; aspect-ratio: var(--_aspect); border-radius: var(--_radius); object-fit: cover; background: color-mix(in srgb, var(--_color) 8%, transparent); }
  [role="status"] { margin: 0; color: var(--_muted); }
  .error { display: grid; justify-items: start; gap: .75rem; }
  button { border: 1px solid var(--_accent); border-radius: var(--_radius); padding: .6rem .9rem; color: #fff; background: var(--_accent); font: inherit; cursor: pointer; }
  button:focus-visible { outline: 3px solid var(--_accent); outline-offset: 3px; }
  @media (prefers-reduced-motion: no-preference) { img { transition: opacity 120ms ease-out; } }
`;

type GalleryVariant = Readonly<{ url: string; width: number; height: number; mime_type: "image/webp" }>;
type GalleryImage = Readonly<{
  public_id: string;
  image_variants: Readonly<{ display: GalleryVariant; thumb: GalleryVariant }>;
  alt_text: string;
  position: number;
  published_at: string;
}>;
type Gallery = Readonly<{
  studio_public_slug: string;
  updated_at: string;
  gallery_images: readonly GalleryImage[];
  artists: readonly Readonly<{ artist_public_slug: string; display_name: string; portfolio_images: readonly GalleryImage[] }>[];
}>;

export function registerInkendarGalleryElement(assetUrl: string = import.meta.url): void {
  if (typeof globalThis.customElements === "undefined" || typeof globalThis.HTMLElement === "undefined" || typeof globalThis.document === "undefined") return;
  if (globalThis.customElements.get(ELEMENT_NAME) !== undefined) return;
  const assetOrigin = parseAssetOrigin(assetUrl);

  class InkendarGalleryElement extends globalThis.HTMLElement {
    static get observedAttributes(): string[] { return ["studio-slug", "api-origin"]; }

    readonly #root: ShadowRoot;
    #controller: AbortController | null = null;
    #requestVersion = 0;

    constructor() {
      super();
      this.#root = this.attachShadow({ mode: "open" });
    }

    connectedCallback(): void {
      void this.#load();
    }

    disconnectedCallback(): void {
      this.#cancel();
    }

    attributeChangedCallback(_name: string, previous: string | null, current: string | null): void {
      if (previous !== current && this.isConnected) void this.#load();
    }

    #cancel(): void {
      this.#requestVersion += 1;
      this.#controller?.abort();
      this.#controller = null;
    }

    async #load(): Promise<void> {
      this.#cancel();
      const version = this.#requestVersion;
      const slug = this.getAttribute("studio-slug") ?? "";
      const origin = this.hasAttribute("api-origin") ? parseOrigin(this.getAttribute("api-origin") ?? "") : assetOrigin;
      if (!PUBLIC_SLUG.test(slug) || origin === null) {
        this.#renderMessage("La galería no tiene una configuración válida.");
        return;
      }

      this.#renderMessage("Cargando galería…");
      const controller = new AbortController();
      this.#controller = controller;
      try {
        const endpoint = new URL(`/api/public/studios/${encodeURIComponent(slug)}/gallery`, origin);
        const response = await fetch(endpoint, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Gallery request failed");
        const gallery = parseGallery(await response.json(), slug);
        if (version !== this.#requestVersion || controller.signal.aborted || !this.isConnected) return;
        this.#controller = null;
        this.#renderGallery(gallery);
      } catch {
        if (version !== this.#requestVersion || controller.signal.aborted || !this.isConnected) return;
        this.#controller = null;
        this.#renderError();
      }
    }

    #renderGallery(gallery: Gallery): void {
      if (gallery.gallery_images.length === 0 && gallery.artists.every((artist) => artist.portfolio_images.length === 0)) {
        this.#renderMessage("Aún no hay imágenes publicadas.");
        return;
      }
      const fragment = document.createDocumentFragment();
      if (gallery.gallery_images.length > 0) fragment.append(createSection("Galería", 2, gallery.gallery_images));
      for (const artist of gallery.artists) {
        if (artist.portfolio_images.length > 0) fragment.append(createSection(artist.display_name, 2, artist.portfolio_images));
      }
      const status = element("p", "Galería cargada.");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      this.#replace(status, fragment);
    }

    #renderMessage(message: string): void {
      const status = element("p", message);
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      this.#replace(status);
    }

    #renderError(): void {
      const wrapper = document.createElement("div");
      wrapper.className = "error";
      const status = element("p", "No se pudo cargar la galería.");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "assertive");
      const retry = element("button", "Reintentar");
      retry.type = "button";
      retry.addEventListener("click", () => void this.#load());
      wrapper.append(status, retry);
      this.#replace(wrapper);
    }

    #replace(...nodes: Node[]): void {
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.#root.replaceChildren(style, ...nodes);
    }
  }

  globalThis.customElements.define(ELEMENT_NAME, InkendarGalleryElement);
}

function createSection(title: string, headingLevel: 2 | 3, images: readonly GalleryImage[]): HTMLElement {
  const section = document.createElement("section");
  const heading = element(`h${headingLevel}`, title);
  const list = document.createElement("ul");
  for (const image of images) {
    const item = document.createElement("li");
    const img = document.createElement("img");
    const { display, thumb } = image.image_variants;
    img.src = display.url;
    img.srcset = `${thumb.url} ${thumb.width}w, ${display.url} ${display.width}w`;
    img.sizes = `(max-width: ${thumb.width}px) 100vw, min(${display.width}px, 100vw)`;
    img.alt = image.alt_text;
    img.width = display.width;
    img.height = display.height;
    img.loading = "lazy";
    img.decoding = "async";
    img.style.setProperty("--_aspect", `${display.width} / ${display.height}`);
    item.append(img);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function parseGallery(input: unknown, expectedSlug: string): Gallery {
  const record = object(input);
  if (record.studio_public_slug !== expectedSlug || typeof record.updated_at !== "string") throw new Error("Invalid gallery");
  const galleryImages = array(record.gallery_images).map(parseImage);
  let imageCount = galleryImages.length;
  const artists = array(record.artists).map((inputArtist) => {
    const artist = object(inputArtist);
    const artistSlug = string(artist.artist_public_slug);
    const displayName = string(artist.display_name);
    if (!PUBLIC_SLUG.test(artistSlug) || displayName.trim() === "" || displayName.length > 160) throw new Error("Invalid artist");
    const portfolioImages = array(artist.portfolio_images).map(parseImage);
    imageCount += portfolioImages.length;
    return {
      artist_public_slug: artistSlug,
      display_name: displayName,
      portfolio_images: portfolioImages,
    };
  });
  if (imageCount > 100) throw new Error("Invalid gallery");
  return { studio_public_slug: expectedSlug, updated_at: record.updated_at, gallery_images: galleryImages, artists };
}

function parseImage(input: unknown): GalleryImage {
  const record = object(input);
  const variants = object(record.image_variants);
  const publicId = string(record.public_id);
  const altText = string(record.alt_text);
  const position = integer(record.position);
  const publishedAt = string(record.published_at);
  if (!PUBLIC_SLUG.test(publicId) || altText.trim() === "" || altText.length > 160 || position < 0) throw new Error("Invalid image");
  return {
    public_id: publicId,
    image_variants: { display: parseVariant(variants.display), thumb: parseVariant(variants.thumb) },
    alt_text: altText,
    position,
    published_at: publishedAt,
  };
}

function parseVariant(input: unknown): GalleryVariant {
  const record = object(input);
  const url = safeRemoteUrl(record.url);
  if (url === null || record.mime_type !== "image/webp" || !positiveInteger(record.width) || !positiveInteger(record.height)) throw new Error("Invalid image variant");
  return { url, width: record.width, height: record.height, mime_type: "image/webp" };
}

function parseAssetOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost(url.hostname))) return url.origin;
  } catch { /* invalid URL */ }
  return null;
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "" && url.pathname !== "/")) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost(url.hostname))) return url.origin;
  } catch { /* invalid URL */ }
  return null;
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost(url.hostname))) return url.href;
  } catch { /* invalid URL */ }
  return null;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid object");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid array");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid string");
  return value;
}

function integer(value: unknown): number {
  if (!Number.isInteger(value)) throw new Error("Invalid integer");
  return value as number;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

registerInkendarGalleryElement();
