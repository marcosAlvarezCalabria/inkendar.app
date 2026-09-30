import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ArtistOption, Customer, TattooCase } from "@inkendar/application";
import type { Route } from "./+types/owner-cases";

import { ownerCustomerCasesHandlers } from "../owner-customer-cases.server.js";
import { EmptyState, Notice, StatusBadge } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";

export type OwnerCasesData = Readonly<{ cases: readonly TattooCase[]; customers: readonly Customer[]; artists: readonly ArtistOption[] }>;

type PendingSubmission = Readonly<
  | { intent: "create" }
  | { intent: "update"; id: string }
>;

export function meta(): Route.MetaDescriptors { return [{ title: "Casos de tatuaje | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerCustomerCasesHandlers.casesLoader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerCustomerCasesHandlers.caseAction(request); }

export default function OwnerCases() {
  const data = useLoaderData() as OwnerCasesData;
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  return <OwnerCasesView data={data} error={actionData?.error} pending={getPendingSubmission(navigation.state, navigation.formData)} />;
}

export function OwnerCasesView({ data, error, pending }: Readonly<{
  data: OwnerCasesData;
  error?: string | undefined;
  pending?: PendingSubmission | undefined;
}>) {
  return (
    <OwnerShell title="Casos de tatuaje" description="Registra el encargo y relaciónalo con cliente y artista.">
      {error ? <Notice tone="danger" title="No se pudo guardar">{error}</Notice> : null}
      <div className="record-workspace">
        <section className="shell-panel" id="new-case" aria-labelledby="new-case-title">
          <h2 id="new-case-title">Nuevo caso</h2>
          {data.customers.length === 0 ? (
            <EmptyState title="Crea un cliente antes de abrir un caso" action={<Link className="button" to="/app/owner/customers">Crear cliente</Link>}>
              Cada caso necesita estar vinculado a un cliente del estudio.
            </EmptyState>
          ) : (
            <Form method="post" className="record-form">
              <input type="hidden" name="intent" value="create" />
              <label>Cliente <select name="customerId" required><option value="">Selecciona un cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <CaseFields artists={data.artists} />
              <SubmitButton pending={pending?.intent === "create"} pendingLabel="Creando caso…">Crear caso</SubmitButton>
            </Form>
          )}
        </section>
        <section className="shell-panel records record-list-panel" aria-labelledby="case-list-title">
          <h2 id="case-list-title">Casos del estudio</h2>
          {data.cases.length === 0 ? (
            <EmptyState
              title="Todavía no hay casos"
              action={data.customers.length > 0 ? <a className="button" href="#new-case">Crear el primer caso</a> : undefined}
            >
              {data.customers.length > 0 ? "Abre un caso para reunir el encargo y su asignación." : "Cuando exista un cliente, podrás abrir aquí su primer caso."}
            </EmptyState>
          ) : data.cases.map((tattooCase) => (
            <CaseForm
              key={tattooCase.id}
              artists={data.artists}
              customerName={data.customers.find((customer) => customer.id === tattooCase.customerId)?.name ?? "No disponible"}
              tattooCase={tattooCase}
              pending={pending?.intent === "update" && pending.id === tattooCase.id}
            />
          ))}
        </section>
      </div>
    </OwnerShell>
  );
}

function CaseForm({ artists, customerName, tattooCase, pending }: Readonly<{
  artists: readonly ArtistOption[];
  customerName: string;
  tattooCase: TattooCase;
  pending: boolean;
}>) {
  const titleId = `case-${tattooCase.id}`;
  const artistName = tattooCase.artistProfileId === null
    ? "Sin asignar"
    : artists.find((artist) => artist.id === tattooCase.artistProfileId)?.displayName ?? "No disponible";
  return (
    <Form method="post" className="record-form record-entry" data-archived={tattooCase.status === "ARCHIVED" ? "" : undefined} aria-labelledby={titleId}>
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="id" value={tattooCase.id} />
      <div className="record-head">
        <h3 id={titleId}>{tattooCase.summary}</h3>
        <StatusBadge tone={tattooCase.status === "OPEN" ? "info" : "neutral"}>{tattooCase.status === "OPEN" ? "Abierto" : "Archivado"}</StatusBadge>
      </div>
      <p className="record-context"><strong>Cliente:</strong> {customerName} · <strong>Artista:</strong> {artistName}</p>
      <CaseFields artists={artists} tattooCase={tattooCase} />
      <label>Estado <select name="status" defaultValue={tattooCase.status}><option value="OPEN">Abierto</option><option value="ARCHIVED">Archivado</option></select></label>
      <p className="record-guidance">Archivar conserva el caso y su contexto.</p>
      <SubmitButton pending={pending} pendingLabel="Guardando caso…">Guardar caso</SubmitButton>
    </Form>
  );
}

function CaseFields({ artists, tattooCase }: { artists: readonly ArtistOption[]; tattooCase?: TattooCase }) {
  return <>
    <label>Resumen <textarea name="summary" required maxLength={500} defaultValue={tattooCase?.summary} /></label>
    <label>Zona corporal <input name="bodyArea" maxLength={120} defaultValue={tattooCase?.bodyArea ?? ""} /></label>
    <label>Tamaño <input name="size" maxLength={120} defaultValue={tattooCase?.size ?? ""} /></label>
    <label>Artista <select name="artistProfileId" defaultValue={tattooCase?.artistProfileId ?? ""}><option value="">Sin asignar</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.displayName}</option>)}</select></label>
  </>;
}

function getPendingSubmission(state: string, formData: FormData | undefined): PendingSubmission | undefined {
  if (state !== "submitting" || !formData) return undefined;
  const intent = formData.get("intent");
  if (intent === "create") return { intent };
  const id = formData.get("id");
  return intent === "update" && typeof id === "string" ? { intent, id } : undefined;
}
