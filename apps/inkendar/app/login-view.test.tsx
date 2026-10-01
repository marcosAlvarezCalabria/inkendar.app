// @vitest-environment happy-dom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    Form: ({ children, ...props }: ComponentProps<"form">) => <form {...props}>{children}</form>,
  };
});

import { LoginForm, loginPendingSubmission } from "./routes/login.js";

describe("login presentation", () => {
  let root: ReturnType<typeof createRoot> | undefined;

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  afterEach(async () => {
    if (root) await act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("focuses email and communicates the current POST while blocking a second submission", () => {
    const formData = new FormData();
    formData.set("email", "owner@example.invalid");
    formData.set("password", "never-render-this");

    expect(loginPendingSubmission("submitting", formData)).toEqual({ email: "owner@example.invalid" });
    expect(loginPendingSubmission("loading", formData)).toBeNull();

    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <LoginForm pending submittedEmail="owner@example.invalid" />,
    );
    const email = container.querySelector<HTMLInputElement>('input[name="email"]');
    const password = container.querySelector<HTMLInputElement>('input[name="password"]');
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(container.querySelector("form")?.method).toContain("post");
    expect(email?.autofocus).toBe(true);
    expect(email?.value).toBe("owner@example.invalid");
    expect(email?.disabled).toBe(true);
    expect(password?.disabled).toBe(true);
    expect(password?.hasAttribute("value")).toBe(false);
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.textContent).toContain("Entrando…");
  });

  it("keeps the typed email when an alert is rendered without persisting the password", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<LoginForm />));
    const email = container.querySelector<HTMLInputElement>('input[name="email"]');
    const password = container.querySelector<HTMLInputElement>('input[name="password"]');
    if (!email || !password) throw new Error("Missing login controls");
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    await act(async () => {
      setInputValue?.call(email, "artist@example.invalid");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue?.call(password, "ephemeral-secret");
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root?.render(<LoginForm actionResult={{ error: "No se pudo iniciar sesión." }} />));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo iniciar sesión.");
    expect((container.querySelector('input[name="email"]') as HTMLInputElement).value).toBe("artist@example.invalid");
    expect((container.querySelector('input[name="password"]') as HTMLInputElement).value).toBe("");
    expect(container.querySelector('input[name="password"]')?.hasAttribute("value")).toBe(false);

    const passwordAfterFirstFailure = container.querySelector<HTMLInputElement>('input[name="password"]');
    if (!passwordAfterFirstFailure) throw new Error("Missing password after first failure");
    await act(async () => {
      setInputValue?.call(passwordAfterFirstFailure, "another-ephemeral-secret");
      passwordAfterFirstFailure.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root?.render(<LoginForm actionResult={{ error: "No se pudo iniciar sesión." }} />));

    expect((container.querySelector('input[name="email"]') as HTMLInputElement).value).toBe("artist@example.invalid");
    expect((container.querySelector('input[name="password"]') as HTMLInputElement).value).toBe("");
  });
});
