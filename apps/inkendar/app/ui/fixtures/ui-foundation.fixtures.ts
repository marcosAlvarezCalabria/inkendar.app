/**
 * Presentation-only fixtures for the visual foundation (product-ui-spec §11).
 * Development and tests only: no route, loader, action or production module imports this file.
 * All data is synthetic: fictitious names and `example.invalid` addresses.
 */
import type { Tone } from "../feedback.js";

export type FixtureScenario<TView, TAction = never> = Readonly<{
  id: string;
  description: string;
  viewport: "mobile" | "tablet" | "desktop";
  view: TView;
  actionResult?: TAction;
  latencyMs?: number;
  transportState?: "online" | "offline" | "error";
}>;

export type UiFoundationView =
  | Readonly<{ kind: "owner-shell"; pathname: string; title: string; description?: string }>
  | Readonly<{ kind: "artist-shell"; displayName: string }>
  | Readonly<{ kind: "public-shell"; title: string; body: string }>
  | Readonly<{ kind: "notices"; items: readonly Readonly<{ tone: Tone; title: string; text?: string }>[] }>
  | Readonly<{ kind: "badges"; items: readonly Readonly<{ tone: Tone; label: string }>[] }>
  | Readonly<{ kind: "states" }>
  | Readonly<{ kind: "form"; error?: string; pending: boolean }>
  | Readonly<{ kind: "status-page"; tone: Tone; title: string; text: string }>;

const toneSamples = [
  { tone: "neutral", label: "Sin asignar" },
  { tone: "info", label: "Abierta" },
  { tone: "pending", label: "Pendiente de confirmación" },
  { tone: "warning", label: "Requiere aprobación" },
  { tone: "success", label: "Confirmada" },
  { tone: "danger", label: "No disponible" },
] as const;

export const uiFoundationScenarios = [
  {
    id: "owner-shell-desktop",
    description: "Shell OWNER con rail persistente y área activa",
    viewport: "desktop",
    view: { kind: "owner-shell", pathname: "/app/owner/customers", title: "Clientes", description: "Directorio operativo del estudio. Archivar conserva el historial." },
  },
  {
    id: "owner-shell-tablet",
    description: "Shell OWNER en tablet con menú modal",
    viewport: "tablet",
    view: { kind: "owner-shell", pathname: "/app/owner/calendars", title: "Google Calendar" },
  },
  {
    id: "owner-shell-mobile",
    description: "Shell OWNER a 320 px con título largo",
    viewport: "mobile",
    view: { kind: "owner-shell", pathname: "/app/owner/offers", title: "Ofertas de fechas preaprobadas para casos abiertos" },
  },
  {
    id: "owner-panel-mobile",
    description: "Panel OWNER sin breadcrumb",
    viewport: "mobile",
    view: { kind: "owner-shell", pathname: "/app/owner", title: "Hola, Estudio Norte" },
  },
  {
    id: "artist-shell-mobile",
    description: "Shell ARTIST de solo lectura",
    viewport: "mobile",
    view: { kind: "artist-shell", displayName: "Lía Artista Sintética" },
  },
  {
    id: "public-shell-mobile",
    description: "Enlace público autocontenido",
    viewport: "mobile",
    view: { kind: "public-shell", title: "Solicitud recibida", body: "Tu elección está pendiente de aprobación del estudio. Todavía no es una cita confirmada." },
  },
  {
    id: "badges-desktop",
    description: "Sellos de estado con glifo y texto",
    viewport: "desktop",
    view: { kind: "badges", items: toneSamples },
  },
  {
    id: "notices-mobile",
    description: "Feedback: error, éxito, aviso, progreso y offline",
    viewport: "mobile",
    view: {
      kind: "notices",
      items: [
        { tone: "danger", title: "No se pudo guardar el cliente", text: "Ya existe un cliente con ese email. Revisa el campo y vuelve a intentarlo." },
        { tone: "success", title: "Cliente guardado" },
        { tone: "warning", title: "La conexión necesita autorización de nuevo", text: "Las asignaciones se conservan. Reconecta para volver a consultar disponibilidad." },
        { tone: "pending", title: "Confirmación en curso", text: "Cerrar esta pantalla no cancela el proceso." },
        { tone: "neutral", title: "Sin conexión", text: "Los datos pueden no estar actualizados. Reconecta antes de enviar cambios." },
      ],
    },
  },
  {
    id: "states-tablet",
    description: "Loading con estructura, empty esperado y proveedor no disponible",
    viewport: "tablet",
    view: { kind: "states" },
  },
  {
    id: "form-error-mobile",
    description: "Campo con ayuda y error asociado",
    viewport: "mobile",
    view: { kind: "form", error: "Escribe un email válido, como nombre@example.invalid", pending: false },
  },
  {
    id: "form-pending-desktop",
    description: "Mutación en curso con botón ocupado",
    viewport: "desktop",
    view: { kind: "form", pending: true },
    latencyMs: 1200,
  },
  {
    id: "denied-mobile",
    description: "Acceso denegado sin revelar datos",
    viewport: "mobile",
    view: { kind: "status-page", tone: "danger", title: "Acceso denegado", text: "Tu cuenta no tiene acceso a esta área." },
  },
] as const satisfies readonly FixtureScenario<UiFoundationView>[];
