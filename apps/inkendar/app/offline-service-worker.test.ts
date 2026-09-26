import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

describe("offline service worker policy", () => {
  it("pre-caches only the explicit public shell allowlist", () => {
    const source = readFileSync(join(publicDir, "sw.js"), "utf8");
    const allowlist = /const PRECACHE_URLS = Object\.freeze\((\[[\s\S]*?\])\);/u.exec(source)?.[1];

    expect(allowlist).toBeDefined();
    expect(JSON.parse(allowlist ?? "[]")).toEqual([
      "/offline.html",
      "/inkendar-mark.svg",
      "/manifest.webmanifest",
    ]);
    expect(source).not.toMatch(/\/api\/|\/app\/|offers\/|availability\//u);
  });

  it("uses the static fallback only for failed navigations and never caches runtime responses", () => {
    const source = readFileSync(join(publicDir, "sw.js"), "utf8");
    const fetchHandler = source.slice(source.indexOf('addEventListener("fetch"'));

    expect(fetchHandler).toContain('request.mode !== "navigate"');
    expect(fetchHandler).toContain('request.method !== "GET"');
    expect(fetchHandler).toContain('caches.match("/offline.html"');
    expect(fetchHandler).not.toMatch(/cache\.put|cache\.add|caches\.open/u);
  });

  it("ships a useful self-contained Spanish fallback", () => {
    const page = readFileSync(join(publicDir, "offline.html"), "utf8");

    expect(page).toContain('<html lang="es"');
    expect(page).toContain("Sin conexión");
    expect(page).toContain("no están disponibles sin conexión");
    expect(page).not.toMatch(/<script\b|<form\b/u);
  });
});
