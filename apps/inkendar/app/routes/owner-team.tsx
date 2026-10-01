import { Form, isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { StudioMember } from "@inkendar/application";
import type { Route } from "./+types/owner-team";

import { ownerAccessHandlers } from "../owner-access.server.js";
import { routeResponseOrThrow } from "../route-response.server.js";
import { AccessDeniedPage, StatusPage } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";

export type OwnerTeamData = Readonly<{
  members: readonly StudioMember[];
  result: "suspended" | "restored" | null;
}>;

export type OwnerTeamPending = Readonly<{
  membershipId: string;
  intent: "SUSPEND" | "RESTORE";
}>;

export function meta(): Route.MetaDescriptors {
  return [{ title: "Equipo y accesos | Inkendar" }];
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerAccessHandlers.loader(request);
  return routeResponseOrThrow(response);
}

export async function action({ request }: Route.ActionArgs) {
  return ownerAccessHandlers.action(request);
}

export default function OwnerTeam() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  return (
    <OwnerTeamView
      data={useLoaderData() as OwnerTeamData}
      error={actionData?.error}
      pending={ownerTeamPendingSubmission(navigation.state, navigation.formData)}
    />
  );
}

export function OwnerTeamView({ data: { members, result }, error, pending = null }: Readonly<{
  data: OwnerTeamData;
  error?: string | undefined;
  pending?: OwnerTeamPending | null;
}>) {
  return (
    <OwnerShell title="Equipo y accesos" description="Gestiona el acceso de los artistas de tu estudio.">
      {result ? (
        <p className="shell-panel" role="status">
          {result === "suspended" ? "Acceso suspendido. El artista ya no puede entrar." : "Acceso restaurado. El artista puede volver a entrar."}
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <section className="records" aria-labelledby="team-members-title">
        <h2 id="team-members-title">Miembros del estudio</h2>
        {members.length === 0 ? <p>No hay miembros disponibles.</p> : members.map((member) => {
          const intent = member.status === "ACTIVE" ? "SUSPEND" : "RESTORE";
          const isPending = pending?.membershipId === member.id && pending.intent === intent;
          return (
            <article className="shell-panel" key={member.id}>
              <h3>{member.displayName}</h3>
              <p>{member.role === "OWNER" ? "Responsable" : "Artista"} · {member.status === "ACTIVE" ? "Activo" : "Suspendido"}</p>
              {member.role === "ARTIST" ? (
                <>
                  <p>{member.status === "ACTIVE"
                    ? "Suspender impide entrar en Inkendar. Sus citas, casos e historial se conservan."
                    : "Restaurar permite volver a entrar con la misma cuenta."}</p>
                  <Form method="post">
                    <input type="hidden" name="intent" value={intent} />
                    <input type="hidden" name="membershipId" value={member.id} />
                    <SubmitButton
                      className={member.status === "ACTIVE" ? "secondary" : undefined}
                      pending={isPending}
                      pendingLabel={member.status === "ACTIVE" ? "Suspendiendo…" : "Restaurando…"}
                    >
                      {member.status === "ACTIVE" ? "Suspender acceso" : "Restaurar acceso"}
                    </SubmitButton>
                  </Form>
                </>
              ) : null}
            </article>
          );
        })}
      </section>
    </OwnerShell>
  );
}

export function ownerTeamPendingSubmission(state: string, formData: FormData | undefined): OwnerTeamPending | null {
  if (state !== "submitting" || !formData) return null;
  const membershipId = formData.get("membershipId");
  const intent = formData.get("intent");
  if (typeof membershipId !== "string" || (intent !== "SUSPEND" && intent !== "RESTORE")) return null;
  return { membershipId, intent };
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 403) return <AccessDeniedPage />;
  return <StatusPage tone="warning" title="Equipo no disponible" action={<Link className="button" to="/app/owner/team">Reintentar</Link>}>
    No se pudieron cargar los accesos. Inténtalo de nuevo más tarde.
  </StatusPage>;
}
