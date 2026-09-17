import { describe, expect, it, vi } from "vitest";
import type { StudioGallery } from "@inkendar/application";

import { createFixedWindowRateLimiter, createPublicGalleryFeedHandler } from "./public-gallery-feed.js";

const slug = "a0000000-0000-4000-8000-000000000001";
const feed: StudioGallery = { studio_public_slug: slug, updated_at: "2026-09-17T10:00:00.000Z", gallery_images: [], artists: [] };

describe("public gallery feed HTTP", () => {
  it("serves cacheable cross-origin JSON with a strong ETag and defensive headers", async () => {
    const get = vi.fn(async () => feed);
    const handler = createPublicGalleryFeedHandler({ get }, createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, now: () => 1_000 }));
    const response = await handler(new Request(`https://app.inkendar.es/api/public/studios/${slug}/gallery`), slug);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60, must-revalidate");
    expect(response.headers.get("ETag")).toMatch(/^"sha256-[A-Za-z0-9_-]{43}"$/u);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(response.headers.get("RateLimit-Limit")).toBe("120");
    expect(await response.json()).toEqual(feed);
  });

  it("returns 304 for matching strong, weak, list or wildcard validators without reserializing private data", async () => {
    const get = vi.fn(async () => feed);
    const handler = createPublicGalleryFeedHandler({ get }, createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, now: () => 1_000 }));
    const first = await handler(new Request("https://app.test/feed"), slug);
    const etag = first.headers.get("ETag")!;
    for (const value of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = await handler(new Request("https://app.test/feed", { headers: { "If-None-Match": value } }), slug);
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("ETag")).toBe(etag);
      expect(response.headers.get("Cache-Control")).toContain("max-age=60");
    }
  });

  it("supports HEAD and rejects every mutating method before loading content", async () => {
    const get = vi.fn(async () => feed);
    const handler = createPublicGalleryFeedHandler({ get }, createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, now: () => 1_000 }));
    const head = await handler(new Request("https://app.test/feed", { method: "HEAD" }), slug);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("ETag")).not.toBeNull();

    const rejected = await handler(new Request("https://app.test/feed", { method: "POST" }), slug);
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("Allow")).toBe("GET, HEAD");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns uniform 404/503 errors without provider detail", async () => {
    const unavailable = createPublicGalleryFeedHandler({ get: vi.fn(async () => { throw Object.assign(new Error("hidden"), { code: "PUBLIC_GALLERY_UNAVAILABLE" }); }) }, createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, now: () => 1_000 }));
    const missing = await unavailable(new Request("https://app.test/feed"), slug);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Galería no disponible.");

    const failed = createPublicGalleryFeedHandler({ get: vi.fn(async () => { throw new Error("provider secret"); }) }, createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, now: () => 1_000 }));
    const response = await failed(new Request("https://app.test/feed"), slug);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Galería no disponible temporalmente.");
  });

  it("enforces a measurable fixed window before persistence and resets deterministically", async () => {
    let now = 1_000;
    const get = vi.fn(async () => feed);
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => now, maxKeys: 10 });
    const handler = createPublicGalleryFeedHandler({ get }, limiter);

    expect((await handler(new Request("https://app.test/feed"), slug)).status).toBe(200);
    const second = await handler(new Request("https://app.test/feed"), slug);
    expect(second.headers.get("RateLimit-Remaining")).toBe("0");
    const limited = await handler(new Request("https://app.test/feed"), slug);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(get).toHaveBeenCalledTimes(2);

    now += 60_000;
    expect((await handler(new Request("https://app.test/feed"), slug)).status).toBe(200);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
