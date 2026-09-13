import { Form, useActionData } from "react-router";
import type { Route } from "./+types/login";

import { authHandlers } from "../auth.server.js";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Acceso | Inkendar" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return await authHandlers.loginPage(request);
}

export async function action({ request }: Route.ActionArgs) {
  return await authHandlers.login(request);
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function Login() {
  const actionData = useActionData<{ error?: string }>();
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Inkendar</p>
        <h1 id="login-title">Accede a tu estudio</h1>
        <p>Usa la cuenta que Inkendar ha aprovisionado para ti.</p>
        <Form method="post" className="auth-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
          <button type="submit">Entrar</button>
        </Form>
      </section>
    </main>
  );
}
