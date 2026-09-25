import type { ComponentProps } from "react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Window } from "happy-dom";
import { MemoryRouter } from "react-router";
import type * as ReactRouterModule from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitted = vi.hoisted(() => vi.fn<(form: HTMLFormElement) => void>());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    Form: ({ children, ...props }: ComponentProps<"form">) => (
      <form
        {...props}
        onSubmit={(event) => {
          event.preventDefault();
          submitted(event.currentTarget);
        }}
      >
        {children}
      </form>
    ),
  };
});

import { OwnerShell } from "./shells.js";

describe("OwnerShell hydrated logout", () => {
  let happyWindow: Window;
  let browserWindow: globalThis.Window;
  let root: ReturnType<typeof hydrateRoot> | undefined;

  beforeEach(() => {
    happyWindow = new Window({ url: "https://app.inkendar.es/app/owner/customers" });
    browserWindow = happyWindow as unknown as globalThis.Window;
    Object.assign(globalThis, {
      window: browserWindow,
      document: browserWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      HTMLFormElement: happyWindow.HTMLFormElement,
      FormData: happyWindow.FormData,
      Event: happyWindow.Event,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    submitted.mockClear();
  });

  afterEach(async () => {
    if (root) await act(() => root?.unmount());
    root = undefined;
    await happyWindow.close();
  });

  it("submits the shared POST form from the compact header after hydration", async () => {
    const app = (
      <MemoryRouter initialEntries={["/app/owner/customers"]}>
        <OwnerShell title="Clientes"><p>Contenido</p></OwnerShell>
      </MemoryRouter>
    );
    const container = browserWindow.document.createElement("div");
    container.innerHTML = renderToString(app);
    browserWindow.document.body.append(container);

    await act(async () => { root = hydrateRoot(container, app); });
    const logout = container.querySelector<HTMLButtonElement>(".topbar-logout");

    expect(logout?.form?.id).toBe("session-logout");
    expect(logout?.form?.method).toBe("post");
    expect(logout?.form?.action).toBe("https://app.inkendar.es/logout");

    logout?.click();
    expect(submitted).toHaveBeenCalledOnce();
    expect(submitted.mock.calls[0]?.[0].id).toBe("session-logout");
  });
});
