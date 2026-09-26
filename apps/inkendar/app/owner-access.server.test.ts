import { describe, expect, it, vi } from "vitest";

import { createAccessSuspensionService, type AccessSuspensionRepositoryPort } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerAccessHandlers } from "./owner-access.server.js";

const access: AuthorizedAccess = {
  displayName: "Owner", role: "OWNER",
  studioId: "20000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
};
const targetId = "40000000-0000-4000-8000-000000000002";

function repository(): AccessSuspensionRepositoryPort {
  return {
    listMembers: vi.fn(async () => [{ id: targetId, displayName: "Artist", role: "ARTIST" as const, status: "ACTIVE" as const }]),
    setArtistStatus: vi.fn(async () => undefined),
  };
}

function subject(repo = repository(), authorize = async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) })) {
  return {
    repo,
    handlers: createOwnerAccessHandlers({ authorize, service: () => createAccessSuspensionService(repo) }),
  };
}

function mutation(form: FormData, origin = "https://app.inkendar.es") {
  return new Request("https://app.inkendar.es/app/owner/team", {
    method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": origin === "https://app.inkendar.es" ? "same-origin" : "cross-site" },
    body: form,
  });
}

function form(intent: string, membershipId = targetId) {
  const body = new FormData();
  body.set("intent", intent);
  body.set("membershipId", membershipId);
  return body;
}

describe("owner access handlers", () => {
  it("lists only the authorized studio privately with rotated cookie headers", async () => {
    const { handlers, repo } = subject();
    const response = await handlers.loader(new Request("https://app.inkendar.es/app/owner/team"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
    expect(repo.listMembers).toHaveBeenCalledWith(access.studioId);
    expect((await response.json()).members).toHaveLength(1);
  });

  it("rejects cross-origin before authorization or form parsing", async () => {
    const authorize = vi.fn(async () => ({ access, headers: new Headers() }));
    const { handlers, repo } = subject(repository(), authorize);
    const response = await handlers.action(mutation(form("SUSPEND"), "https://evil.example"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(authorize).not.toHaveBeenCalled();
    expect(repo.setArtistStatus).not.toHaveBeenCalled();
  });

  it("suspends and restores by POST, deriving identity from the authorized request", async () => {
    const { handlers, repo } = subject();
    const suspended = await handlers.action(mutation(form("SUSPEND")));
    const restored = await handlers.action(mutation(form("RESTORE")));
    expect(suspended.status).toBe(303);
    expect(suspended.headers.get("Location")).toBe("/app/owner/team?result=suspended");
    expect(restored.headers.get("Location")).toBe("/app/owner/team?result=restored");
    expect(repo.setArtistStatus).toHaveBeenNthCalledWith(1, targetId, "SUSPENDED");
    expect(repo.setArtistStatus).toHaveBeenNthCalledWith(2, targetId, "ACTIVE");
  });

  it("passes the refreshed authorization session to the repository factory", async () => {
    const sessionClient = { refreshed: true };
    const authorization = { access, headers: new Headers({ "Set-Cookie": "session=rotated" }), sessionClient };
    const service = vi.fn(() => createAccessSuspensionService(repository()));
    const handlers = createOwnerAccessHandlers({ authorize: async () => authorization, service });

    const response = await handlers.action(mutation(form("SUSPEND")));

    expect(response.status).toBe(303);
    expect(service).toHaveBeenCalledWith(expect.any(Request), authorization);
    expect(response.headers.get("Set-Cookie")).toContain("session=rotated");
  });

  it("rejects invalid or extra fields and sanitizes persistence errors", async () => {
    const { handlers, repo } = subject();
    const extra = form("SUSPEND"); extra.set("studioId", "foreign");
    expect((await handlers.action(mutation(extra))).status).toBe(400);
    expect((await handlers.action(mutation(form("DELETE")))).status).toBe(400);
    expect((await handlers.action(mutation(form("SUSPEND", "bad-id")))).status).toBe(400);
    expect(repo.setArtistStatus).not.toHaveBeenCalled();
    vi.mocked(repo.setArtistStatus).mockRejectedValueOnce(new Error("private provider details"));
    const response = await handlers.action(mutation(form("SUSPEND")));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private provider details");
  });

  it("does not create a repository for denied authorization", async () => {
    const denied = new Response("Acceso denegado", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    const repo = repository();
    const { handlers } = subject(repo, async () => denied as never);
    expect((await handlers.loader(new Request("https://app.inkendar.es/app/owner/team"))).status).toBe(403);
    expect(repo.listMembers).not.toHaveBeenCalled();
  });
});
