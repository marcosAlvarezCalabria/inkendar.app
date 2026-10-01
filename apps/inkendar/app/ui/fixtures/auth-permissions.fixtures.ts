import type { OwnerTeamData, OwnerTeamPending } from "../../routes/owner-team.js";
import type { LoginActionResult } from "../../routes/login.js";

type Viewport = "compact" | "mobile" | "tablet" | "desktop";

export type AuthPermissionsFixtureView = Readonly<
  | {
    kind: "login";
    actionResult?: LoginActionResult;
    pending: boolean;
    submittedEmail?: string;
  }
  | {
    kind: "team";
    data: OwnerTeamData;
    pending: OwnerTeamPending;
  }
>;

type AuthPermissionsFixtureScenario = Readonly<{
  id: string;
  description: string;
  viewport: Viewport;
  view: AuthPermissionsFixtureView;
}>;

const viewports = ["compact", "mobile", "tablet", "desktop"] as const;
const teamData = {
  result: null,
  members: [
    { id: "owner-synthetic", displayName: "Álex Owner Sintético", role: "OWNER", status: "ACTIVE" },
    { id: "artist-active-synthetic", displayName: "Noa Artista de línea fina", role: "ARTIST", status: "ACTIVE" },
    { id: "artist-suspended-synthetic", displayName: "Iker Artista suspendido", role: "ARTIST", status: "SUSPENDED" },
  ],
} satisfies OwnerTeamData;

export const authPermissionsFixtureScenarios = viewports.flatMap((viewport, index) => {
  const loginPending = index % 2 === 1;
  const teamPending: OwnerTeamPending = index % 2 === 0
    ? { membershipId: "artist-active-synthetic", intent: "SUSPEND" }
    : { membershipId: "artist-suspended-synthetic", intent: "RESTORE" };
  return [
    {
      id: `login-access-${viewport}`,
      description: `Acceso ${loginPending ? "enviando" : "con error recuperable"}`,
      viewport,
      view: {
        kind: "login",
        pending: loginPending,
        submittedEmail: "artista.frontdesk@example.invalid",
        ...(loginPending ? {} : { actionResult: { error: "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo." } }),
      },
    },
    {
      id: `team-access-${viewport}`,
      description: `Equipo con ${teamPending.intent === "SUSPEND" ? "suspensión" : "restauración"} en curso`,
      viewport,
      view: { kind: "team", data: teamData, pending: teamPending },
    },
  ] as const;
}) satisfies readonly AuthPermissionsFixtureScenario[];
