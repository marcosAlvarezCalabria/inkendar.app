import { Form, Link, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { StudioMember } from "@inkendar/application";
import type { Route } from "./+types/owner-team";

import { ownerAccessHandlers } from "../owner-access.server.js";
import { StatusPage } from "../ui/feedback.js";
import { OwnerShell } from "../ui/shells.js";

export type OwnerTeamData = Readonly<{
  members: readonly StudioMember[];
  result: "suspended" | "restored" | null;
}>;

export function meta(): Route.MetaDescriptors {
  return [{ title: "Equipo y accesos | Inkendar" }];
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const response = await ownerAccessHandlers.loader(request);
  if (response.status >= 400) throw new Response(null, { status: response.status, headers: response.headers });
  return response;
}

export async function action({ request }: Route.ActionArgs) {
  return ownerAccessHandlers.action(request);
}

export default function OwnerTeam() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  return <OwnerTeamView data={useLoaderData() as OwnerTeamData} error={actionData?.error} busy={navigation.state === "submitting"} />;
}

export function OwnerTeamView({ data: { members, result }, error, busy = false }: { data: OwnerTeamData; error?: string | undefined; busy?: boolean }) {
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
        {members.length === 0 ? <p>No hay miembros disponibles.</p> : members.map((member) => (
          <article className="shell-panel" key={member.id}>
            <h3>{member.displayName}</h3>
            <p>{member.role === "OWNER" ? "Responsable" : "Artista"} · {member.status === "ACTIVE" ? "Activo" : "Suspendido"}</p>
            {member.role === "ARTIST" ? (
              <>
                <p>{member.status === "ACTIVE"
                  ? "Suspender impide entrar en Inkendar. Sus citas, casos e historial se conservan."
                  : "Restaurar permite volver a entrar con la misma cuenta."}</p>
                <Form method="post">
                  <input type="hidden" name="intent" value={member.status === "ACTIVE" ? "SUSPEND" : "RESTORE"} />
                  <input type="hidden" name="membershipId" value={member.id} />
                  <button type="submit" className={member.status === "ACTIVE" ? "secondary" : undefined} disabled={busy}>
                    {member.status === "ACTIVE" ? "Suspender acceso" : "Restaurar acceso"}
                  </button>
                </Form>
              </>
            ) : null}
          </article>
        ))}
      </section>
    </OwnerShell>
  );
}

export function ErrorBoundary() {
  useRouteError();
  return <StatusPage tone="warning" title="Equipo no disponible" action={<Link className="button" to="/app/owner/team">Reintentar</Link>}>
    No se pudieron cargar los accesos. Inténtalo de nuevo más tarde.
  </StatusPage>;
}
