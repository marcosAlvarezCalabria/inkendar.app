import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ArtistOption, Customer, TattooCase } from "@inkendar/application";
import type { Route } from "./+types/owner-cases";

import { ownerCustomerCasesHandlers } from "../owner-customer-cases.server.js";

type LoaderData = { cases: readonly TattooCase[]; customers: readonly Customer[]; artists: readonly ArtistOption[] };

export function meta(): Route.MetaDescriptors { return [{ title: "Casos de tatuaje | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerCustomerCasesHandlers.casesLoader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerCustomerCasesHandlers.caseAction(request); }

export default function OwnerCases() {
  const data = useLoaderData() as LoaderData;
  const actionData = useActionData() as { error?: string } | undefined;
  return (
    <main className="shell-page">
      <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Casos de tatuaje</h1></div><Link to="/app/owner">Volver al panel</Link></header>
      {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
      <section className="shell-panel">
        <h2>Nuevo caso</h2>
        {data.customers.length === 0 ? <p>Crea un cliente antes de abrir un caso.</p> : (
          <Form method="post" className="record-form">
            <input type="hidden" name="intent" value="create" />
            <label>Cliente <select name="customerId" required><option value="">Selecciona un cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <CaseFields artists={data.artists} />
            <button type="submit">Crear caso</button>
          </Form>
        )}
      </section>
      <section className="records" aria-labelledby="case-list-title">
        <h2 id="case-list-title">Casos del estudio</h2>
        {data.cases.length === 0 ? <p>Todavía no hay casos.</p> : data.cases.map((tattooCase) => (
          <Form method="post" className="shell-panel record-form" key={tattooCase.id}>
            <input type="hidden" name="intent" value="update" /><input type="hidden" name="id" value={tattooCase.id} />
            <p>Cliente: {data.customers.find((customer) => customer.id === tattooCase.customerId)?.name ?? "No disponible"}</p>
            <CaseFields artists={data.artists} tattooCase={tattooCase} />
            <label>Estado <select name="status" defaultValue={tattooCase.status}><option value="OPEN">Abierto</option><option value="ARCHIVED">Archivado</option></select></label>
            <button type="submit">Guardar caso</button>
          </Form>
        ))}
      </section>
    </main>
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
