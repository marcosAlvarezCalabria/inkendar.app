import { data, Form, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/owner";

import { authHandlers } from "../auth.server.js";

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

export default function OwnerShell() {
  const { displayName } = useLoaderData<typeof loader>();
  return (
    <main className="shell-page">
      <header className="shell-header">
        <div><p className="eyebrow">Inkendar · Owner</p><h1>Hola, {displayName}</h1></div>
        <Form method="post" action="/logout"><button className="secondary" type="submit">Cerrar sesión</button></Form>
      </header>
      <section className="shell-panel">
        <h2>Panel del estudio</h2>
        <nav className="owner-nav" aria-label="Operación del estudio">
          <a href="/app/owner/conversations">Gestionar conversaciones</a>
          <a href="/app/owner/customers">Gestionar clientes</a>
          <a href="/app/owner/cases">Gestionar casos de tatuaje</a>
          <a href="/app/owner/calendars">Gestionar Google Calendar</a>
          <a href="/app/owner/offers">Gestionar ofertas de fechas</a>
          <a href="/app/owner/gallery">Gestionar galería privada</a>
        </nav>
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return isRouteErrorResponse(error) && error.status === 403 ? <Denied /> : <Denied />;
}

function Denied() {
  return <main className="status-page"><p className="eyebrow">Inkendar</p><h1>Acceso denegado</h1><p>Tu cuenta no tiene acceso a esta área.</p></main>;
}
