import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedActionOriginsFromCanonicalOrigin } from "./app-origin-config.js";

const originalAppOrigin = process.env.INKENDAR_APP_ORIGIN;

afterEach(() => {
  if (originalAppOrigin === undefined) delete process.env.INKENDAR_APP_ORIGIN;
  else process.env.INKENDAR_APP_ORIGIN = originalAppOrigin;
  vi.resetModules();
});

describe("React Router action origin configuration", () => {
  it.each([
    ["http://127.0.0.1:3000", "127.0.0.1:3000"],
    ["https://inkendar.calalva82.workers.dev", "inkendar.calalva82.workers.dev"],
    ["https://inkendar-staging.calalva82.workers.dev", "inkendar-staging.calalva82.workers.dev"],
  ])("derives the one allowed host from canonical origin %s", (origin, host) => {
    expect(allowedActionOriginsFromCanonicalOrigin(origin)).toEqual([host]);
  });

  it.each([
    ["a missing value", undefined],
    ["an empty value", ""],
    ["a non-HTTP URL", "ftp://app.inkendar.es"],
    ["a URL with a path", "https://app.inkendar.es/availability"],
    ["a URL with credentials", "https://user:password@app.inkendar.es"],
    ["a wildcard host", "https://*.inkendar.es"],
  ])("fails closed for %s", (_case, origin) => {
    expect(() => allowedActionOriginsFromCanonicalOrigin(origin)).toThrow(/INKENDAR_APP_ORIGIN/);
  });

  it("wires the derived host into the React Router config", async () => {
    process.env.INKENDAR_APP_ORIGIN = "https://inkendar.calalva82.workers.dev";

    const { default: config } = await import("./react-router.config.js");

    expect(config.allowedActionOrigins).toEqual(["inkendar.calalva82.workers.dev"]);
  });
});
