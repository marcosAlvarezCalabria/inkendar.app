import { data, Form, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/artist";

import { authHandlers } from "../auth.server.js";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Área del artista | Inkendar" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const access = await authHandlers.requireRole(request, "ARTIST");
  if (access instanceof Response) return access;
  return data({ displayName: access.access.displayName }, { headers: access.headers });
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function ArtistShell() {
  const { displayName } = useLoaderData<typeof loader>();
  return (
    <main className="shell-page">
      <header className="shell-header">
        <div><p className="eyebrow">Inkendar · Artista</p><h1>Hola, {displayName}</h1></div>
        <Form method="post" action="/logout"><button className="secondary" type="submit">Cerrar sesión</button></Form>
      </header>
      <section className="shell-panel"><h2>Vista de solo lectura</h2><p>Aquí podrás consultar tu agenda y el contexto asignado cuando esos módulos estén disponibles.</p></section>
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
