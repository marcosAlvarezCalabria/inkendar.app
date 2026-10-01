import { useCallback, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";

import { authHandlers } from "../auth.server.js";
import { SubmitButton } from "../ui/forms.js";

export type LoginActionResult = Readonly<{ error?: string }>;

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
  const actionData = useActionData<LoginActionResult>();
  const navigation = useNavigation();
  const submission = loginPendingSubmission(navigation.state, navigation.formData);
  return <LoginForm actionResult={actionData} pending={submission !== null} submittedEmail={submission?.email} />;
}

export function LoginForm({ actionResult, pending = false, submittedEmail }: Readonly<{
  actionResult?: LoginActionResult | undefined;
  pending?: boolean;
  submittedEmail?: string | undefined;
}>) {
  const [email, setEmail] = useState(submittedEmail ?? "");
  const clearPasswordAfterAction = useCallback((password: HTMLInputElement | null) => {
    if (actionResult?.error && password) password.value = "";
  }, [actionResult]);
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Inkendar</p>
        <h1 id="login-title">Accede a tu estudio</h1>
        <p>Usa la cuenta que Inkendar ha aprovisionado para ti.</p>
        <Form method="post" className="auth-form">
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              disabled={pending}
              value={submittedEmail ?? email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          <label>
            Contraseña
            <input ref={clearPasswordAfterAction} name="password" type="password" autoComplete="current-password" required disabled={pending} />
          </label>
          {actionResult?.error ? <p className="form-error" role="alert">{actionResult.error}</p> : null}
          <SubmitButton pending={pending} pendingLabel="Entrando…">Entrar</SubmitButton>
        </Form>
      </section>
    </main>
  );
}

export function loginPendingSubmission(state: string, formData: FormData | undefined): Readonly<{ email: string }> | null {
  if (state !== "submitting" || !formData) return null;
  const email = formData.get("email");
  return { email: typeof email === "string" ? email : "" };
}
