import { data, isRouteErrorResponse, Link, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/owner";

import { authHandlers } from "../auth.server.js";
import { routeResponseOrThrow } from "../route-response.server.js";
import { AccessDeniedPage, StatusPage } from "../ui/feedback.js";
import { OwnerShell } from "../ui/shells.js";

const ownerAreas = [
  {
    to: "/app/owner/conversations",
    verb: "Atender",
    title: "Conversaciones",
    description: "Revisa la bandeja y responde las consultas que llegan al estudio.",
  },
  {
    to: "/app/owner/customers",
    verb: "Organizar",
    title: "Clientes",
    description: "Crea y mantén al día los datos de contacto de cada cliente.",
  },
  {
    to: "/app/owner/cases",
    verb: "Preparar",
    title: "Casos",
    description: "Registra cada trabajo, su contexto y el artista asignado.",
  },
  {
    to: "/app/owner/calendars",
    verb: "Coordinar",
    title: "Calendario",
    description: "Configura Google Calendar, la disponibilidad y las solicitudes pendientes.",
  },
  {
    to: "/app/owner/offers",
    verb: "Proponer",
    title: "Ofertas",
    description: "Prepara opciones de fecha y sigue su estado hasta la elección.",
  },
  {
    to: "/app/owner/gallery",
    verb: "Publicar",
    title: "Galería",
    description: "Cura las imágenes del estudio y de cada portfolio antes de publicarlas.",
  },
  {
    to: "/app/owner/team",
    verb: "Administrar",
    title: "Equipo",
    description: "Revisa los miembros y suspende o restaura el acceso de cada artista.",
  },
] as const;

export function meta(): Route.MetaDescriptors {
  return [{ title: "Panel del estudio | Inkendar" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const access = await authHandlers.requireRole(request, "OWNER");
  if (access instanceof Response) return routeResponseOrThrow(access);
  return data({ displayName: access.access.displayName }, { headers: access.headers });
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function OwnerPanel() {
  const { displayName } = useLoaderData<typeof loader>();
  return <OwnerPanelView displayName={displayName} />;
}

export function OwnerPanelView({ displayName }: Readonly<{ displayName: string }>) {
  return (
    <OwnerShell
      title={`Hola, ${displayName}`}
      description="Elige un área para continuar con el trabajo del estudio."
    >
      <section className="shell-panel" aria-labelledby="owner-areas-title">
        <h2 id="owner-areas-title">Panel del estudio</h2>
        <ul className="owner-nav">
          {ownerAreas.map((area) => (
            <li className="owner-area-card" key={area.to}>
              <Link to={area.to}>
                <span className="owner-area-verb">{area.verb}</span>
                <h3>{area.title}</h3>
                <p>{area.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </OwnerShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 403) return <AccessDeniedPage />;
  return <StatusPage tone="warning" title="Panel no disponible">No se pudo cargar el panel del estudio.</StatusPage>;
}
