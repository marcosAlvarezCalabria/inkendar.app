import { data, isRouteErrorResponse, Link, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/owner";

import { authHandlers } from "../auth.server.js";
import { StatusPage } from "../ui/feedback.js";
import { OwnerShell } from "../ui/shells.js";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Panel del estudio | Inkendar" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const access = await authHandlers.requireRole(request, "OWNER");
  if (access instanceof Response) return access;
  return data({ displayName: access.access.displayName }, { headers: access.headers });
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function OwnerPanel() {
  const { displayName } = useLoaderData<typeof loader>();
  return (
    <OwnerShell title={`Hola, ${displayName}`}>
      <section className="shell-panel" aria-labelledby="owner-areas-title">
        <h2 id="owner-areas-title">Panel del estudio</h2>
        <ul className="owner-nav">
          <li><Link to="/app/owner/conversations">Gestionar conversaciones</Link></li>
          <li><Link to="/app/owner/customers">Gestionar clientes</Link></li>
          <li><Link to="/app/owner/cases">Gestionar casos de tatuaje</Link></li>
          <li><Link to="/app/owner/calendars">Gestionar Google Calendar</Link></li>
          <li><Link to="/app/owner/offers">Gestionar ofertas de fechas</Link></li>
          <li><Link to="/app/owner/gallery">Gestionar galería privada</Link></li>
        </ul>
      </section>
    </OwnerShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return isRouteErrorResponse(error) && error.status === 403 ? <Denied /> : <Denied />;
}

function Denied() {
  return <StatusPage tone="danger" title="Acceso denegado">Tu cuenta no tiene acceso a esta área.</StatusPage>;
}
