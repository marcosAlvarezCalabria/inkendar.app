import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Customer } from "@inkendar/application";
import type { Route } from "./+types/owner-customers";

import { ownerCustomerCasesHandlers } from "../owner-customer-cases.server.js";
import { EmptyState, Notice, StatusBadge } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";

type PendingSubmission = Readonly<
  | { intent: "create" }
  | { intent: "update"; id: string }
>;

export function meta(): Route.MetaDescriptors { return [{ title: "Clientes | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerCustomerCasesHandlers.customersLoader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerCustomerCasesHandlers.customerAction(request); }

export default function OwnerCustomers() {
  const { customers } = useLoaderData() as { customers: readonly Customer[] };
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  return <OwnerCustomersView customers={customers} error={actionData?.error} pending={getPendingSubmission(navigation.state, navigation.formData)} />;
}

export function OwnerCustomersView({ customers, error, pending }: Readonly<{
  customers: readonly Customer[];
  error?: string | undefined;
  pending?: PendingSubmission | undefined;
}>) {
  return (
    <OwnerShell title="Clientes" description="Crea y mantén el directorio operativo del estudio.">
      {error ? <Notice tone="danger" title="No se pudo guardar">{error}</Notice> : null}
      <div className="record-workspace">
        <section className="shell-panel" id="new-customer" aria-labelledby="new-customer-title">
          <h2 id="new-customer-title">Nuevo cliente</h2>
          <Form method="post" className="record-form">
            <input type="hidden" name="intent" value="create" />
            <label>Nombre <input name="name" required maxLength={120} autoComplete="name" /></label>
            <label>Email <input name="email" type="email" maxLength={254} autoComplete="email" /></label>
            <label>Teléfono internacional <input name="phone" type="tel" placeholder="+34600123456" autoComplete="tel" /></label>
            <SubmitButton pending={pending?.intent === "create"} pendingLabel="Creando cliente…">Crear cliente</SubmitButton>
          </Form>
        </section>
        <section className="shell-panel records record-list-panel" aria-labelledby="customer-list-title">
          <h2 id="customer-list-title">Clientes del estudio</h2>
          {customers.length === 0 ? (
            <EmptyState title="Todavía no hay clientes" action={<a className="button" href="#new-customer">Crear el primer cliente</a>}>
              Crea el primer registro para poder abrir y relacionar casos.
            </EmptyState>
          ) : customers.map((customer) => (
            <CustomerForm key={customer.id} customer={customer} pending={pending?.intent === "update" && pending.id === customer.id} />
          ))}
        </section>
      </div>
    </OwnerShell>
  );
}

function CustomerForm({ customer, pending }: Readonly<{ customer: Customer; pending: boolean }>) {
  const titleId = `customer-${customer.id}`;
  return (
    <Form method="post" className="record-form record-entry" data-archived={customer.status === "ARCHIVED" ? "" : undefined} aria-labelledby={titleId}>
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="id" value={customer.id} />
      <div className="record-head">
        <h3 id={titleId}>{customer.name}</h3>
        <StatusBadge tone={customer.status === "ACTIVE" ? "success" : "neutral"}>{customer.status === "ACTIVE" ? "Activo" : "Archivado"}</StatusBadge>
      </div>
      <label>Nombre <input name="name" required maxLength={120} defaultValue={customer.name} /></label>
      <label>Email <input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} /></label>
      <label>Teléfono internacional <input name="phone" type="tel" defaultValue={customer.phone ?? ""} /></label>
      <label>Estado <select name="status" defaultValue={customer.status}><option value="ACTIVE">Activo</option><option value="ARCHIVED">Archivado</option></select></label>
      <p className="record-guidance">Archivar conserva el cliente y su historial.</p>
      <SubmitButton pending={pending} pendingLabel="Guardando cliente…">Guardar cliente</SubmitButton>
    </Form>
  );
}

function getPendingSubmission(state: string, formData: FormData | undefined): PendingSubmission | undefined {
  if (state !== "submitting" || !formData) return undefined;
  const intent = formData.get("intent");
  if (intent === "create") return { intent };
  const id = formData.get("id");
  return intent === "update" && typeof id === "string" ? { intent, id } : undefined;
}
