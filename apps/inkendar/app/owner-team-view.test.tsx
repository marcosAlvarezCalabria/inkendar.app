import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import {
  ownerTeamPendingSubmission,
  OwnerTeamView,
  type OwnerTeamData,
  type OwnerTeamPending,
} from "./routes/owner-team.js";

function render(
  members: OwnerTeamData["members"],
  result: OwnerTeamData["result"] = null,
  error?: string,
  pending?: OwnerTeamPending,
): string {
  const router = createMemoryRouter([{
    path: "/app/owner/team",
    element: (
      <OwnerTeamView
        data={{ members, result }}
        {...(error ? { error } : {})}
        {...(pending ? { pending } : {})}
      />
    ),
  }], { initialEntries: ["/app/owner/team"] });
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("owner team access view", () => {
  it("shows member status and a labeled touch action only for artists", () => {
    const html = render([
      { id: "owner-id", displayName: "Owner", role: "OWNER", status: "ACTIVE" },
      { id: "artist-id", displayName: "Artist", role: "ARTIST", status: "ACTIVE" },
    ]);
    expect(html).toContain("Owner");
    expect(html).toContain("Artist");
    expect(html).toContain("Activo");
    expect(html).toContain("Suspender acceso");
    expect(html).toContain('value="artist-id"');
    expect(html).not.toContain('value="owner-id"');
    expect(html).toMatch(/<form[^>]*method="post"/iu);
  });

  it("offers restoration for a suspended artist with explicit success feedback", () => {
    const html = render([{ id: "artist-id", displayName: "Artist", role: "ARTIST", status: "SUSPENDED" }], "restored");
    expect(html).toContain("Suspendido");
    expect(html).toContain("Restaurar acceso");
    expect(html).toContain('role="status"');
    expect(html).toContain("Acceso restaurado");
  });

  it("shows a sanitized action error with alert semantics", () => {
    const html = render([], null, "Acceso denegado.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Acceso denegado.");
  });

  it("marks only the submitted artist action as pending from membership and intent", () => {
    const formData = new FormData();
    formData.set("membershipId", "active-artist");
    formData.set("intent", "SUSPEND");
    const pending = ownerTeamPendingSubmission("submitting", formData);

    expect(pending).toEqual({ membershipId: "active-artist", intent: "SUSPEND" });
    expect(ownerTeamPendingSubmission("loading", formData)).toBeNull();

    const html = render([
      { id: "active-artist", displayName: "Artist A", role: "ARTIST", status: "ACTIVE" },
      { id: "suspended-artist", displayName: "Artist B", role: "ARTIST", status: "SUSPENDED" },
    ], null, undefined, pending ?? undefined);
    const activeForm = formForMembership(html, "active-artist");
    const suspendedForm = formForMembership(html, "suspended-artist");

    expect(activeForm).toContain("Suspendiendo…");
    expect(activeForm).toContain("disabled");
    expect(activeForm).toContain('aria-busy="true"');
    expect(suspendedForm).toContain("Restaurar acceso");
    expect(suspendedForm).not.toContain("disabled");
    expect(suspendedForm).not.toContain("aria-busy");

    const restoreData = new FormData();
    restoreData.set("membershipId", "suspended-artist");
    restoreData.set("intent", "RESTORE");
    const restorePending = ownerTeamPendingSubmission("submitting", restoreData);
    const restoreHtml = render([
      { id: "active-artist", displayName: "Artist A", role: "ARTIST", status: "ACTIVE" },
      { id: "suspended-artist", displayName: "Artist B", role: "ARTIST", status: "SUSPENDED" },
    ], null, undefined, restorePending ?? undefined);

    expect(formForMembership(restoreHtml, "active-artist")).not.toContain("disabled");
    expect(formForMembership(restoreHtml, "suspended-artist")).toContain("Restaurando…");
    expect(formForMembership(restoreHtml, "suspended-artist")).toContain("disabled");
  });
});

function formForMembership(html: string, membershipId: string): string {
  const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/giu)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`value="${membershipId}"`));
  if (!form) throw new Error(`Missing form for ${membershipId}`);
  return form;
}
