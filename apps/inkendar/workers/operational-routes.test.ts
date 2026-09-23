import { describe, expect, it } from "vitest";
import { operationalResponse } from "./operational-routes.js";

const readyEnvironment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  INKENDAR_APP_ORIGIN: "https://app.inkendar.es",
  IMAGES: {},
};

describe("operational routes", () => {
  it("serves a cache-free liveness response without inspecting configuration", async () => {
    const response = operationalResponse(new Request("https://app.inkendar.es/healthz"), {});
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ status: "ok" });
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports readiness only when core bindings are present without naming missing secrets", async () => {
    const ready = operationalResponse(new Request("https://app.inkendar.es/readyz"), readyEnvironment);
    const unready = operationalResponse(new Request("https://app.inkendar.es/readyz"), { ...readyEnvironment, SUPABASE_SERVICE_ROLE_KEY: "" });

    expect(ready?.status).toBe(200);
    expect(await ready?.json()).toEqual({ status: "ready" });
    expect(unready?.status).toBe(503);
    expect(await unready?.json()).toEqual({ status: "not-ready" });
  });

  it("ignores application routes", () => {
    expect(operationalResponse(new Request("https://app.inkendar.es/login"), readyEnvironment)).toBeNull();
  });
});
