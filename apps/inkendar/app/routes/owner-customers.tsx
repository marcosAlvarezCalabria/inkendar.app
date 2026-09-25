import { Form, useActionData, useLoaderData } from "react-router";
import { OwnerShell } from "../ui/shells.js";
import type { Customer } from "@inkendar/application";
import type { Route } from "./+types/owner-customers";

import { ownerCustomerCasesHandlers } from "../owner-customer-cases.server.js";

export function meta(): Route.MetaDescriptors { return [{ title: "Clientes | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerCustomerCasesHandlers.customersLoader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerCustomerCasesHandlers.customerAction(request); }

export default function OwnerCustomers() {
  const { customers } = useLoaderData() as { customers: readonly Customer[] };
  const actionData = useActionData() as { error?: string } | undefined;
  return (
    <OwnerShell title="Clientes">
      {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
      <section className="shell-panel">
        <h2>Nuevo cliente</h2>
        <Form method="post" className="record-form">
          <input type="hidden" name="intent" value="create" />
          <label>Nombre <input name="name" required maxLength={120} autoComplete="name" /></label>
          <label>Email <input name="email" type="email" maxLength={254} autoComplete="email" /></label>
          <label>Teléfono internacional <input name="phone" type="tel" placeholder="+34600123456" autoComplete="tel" /></label>
          <button type="submit">Crear cliente</button>
        </Form>
      </section>
      <section className="records" aria-labelledby="customer-list-title">
        <h2 id="customer-list-title">Clientes del estudio</h2>
        {customers.length === 0 ? <p>Todavía no hay clientes.</p> : customers.map((customer) => <CustomerForm key={customer.id} customer={customer} />)}
      </section>
    </OwnerShell>
  );
}

function CustomerForm({ customer }: { customer: Customer }) {
  return (
    <Form method="post" className="shell-panel record-form">
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="id" value={customer.id} />
      <label>Nombre <input name="name" required maxLength={120} defaultValue={customer.name} /></label>
      <label>Email <input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} /></label>
      <label>Teléfono internacional <input name="phone" type="tel" defaultValue={customer.phone ?? ""} /></label>
      <label>Estado <select name="status" defaultValue={customer.status}><option value="ACTIVE">Activo</option><option value="ARCHIVED">Archivado</option></select></label>
      <button type="submit">Guardar cliente</button>
    </Form>
  );
}
