import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { OwnerTeamView, type OwnerTeamData } from "./routes/owner-team.js";

function render(members: OwnerTeamData["members"], result: OwnerTeamData["result"] = null, error?: string): string {
  const router = createMemoryRouter([{
    path: "/app/owner/team",
    element: <OwnerTeamView data={{ members, result }} error={error} />,
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
});
