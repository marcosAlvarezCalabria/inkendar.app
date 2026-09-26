import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineBoundary, registerServiceWorker } from "./offline-support.js";

describe("offline support", () => {
  let happyWindow: Window;
  let browserWindow: globalThis.Window;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    happyWindow = new Window({ url: "https://app.inkendar.es/app/owner/customers" });
    browserWindow = happyWindow as unknown as globalThis.Window;
    Object.assign(globalThis, {
      window: browserWindow,
      document: browserWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      HTMLFormElement: happyWindow.HTMLFormElement,
      Event: happyWindow.Event,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
  });

  afterEach(async () => {
    if (root) await act(() => root?.unmount());
    root = undefined;
    await happyWindow.close();
  });

  it("registers the service worker only when the browser supports it", async () => {
    const register = vi.fn().mockResolvedValue(undefined);

    await registerServiceWorker({ serviceWorker: { register } });
    await registerServiceWorker({});

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("announces stale data, blocks mutations without clearing fields, and recovers online", async () => {
    Object.defineProperty(browserWindow.navigator, "onLine", { configurable: true, value: true });
    const submitted = vi.fn();
    const container = browserWindow.document.createElement("div");
    browserWindow.document.body.append(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <OfflineBoundary>
          <form method="post" onSubmit={(event) => { event.preventDefault(); submitted(); }}>
            <label>Nombre <input name="name" defaultValue="Contexto seguro" /></label>
            <button type="submit">Guardar</button>
          </form>
        </OfflineBoundary>,
      );
    });

    const form = container.querySelector("form");
    const input = container.querySelector<HTMLInputElement>("input");
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(container.querySelector('[data-offline-notice]')).toBeNull();
    expect(button?.disabled).toBe(false);

    Object.defineProperty(browserWindow.navigator, "onLine", { configurable: true, value: false });
    await act(async () => { browserWindow.dispatchEvent(new Event("offline")); });

    expect(container.querySelector('[data-offline-notice]')?.getAttribute("role")).toBe("status");
    expect(container.textContent).toContain("Sin conexión");
    expect(container.textContent).toContain("pueden no estar actualizados");
    expect(container.textContent).toContain("Reconecta antes de enviar cambios");
    expect(button?.disabled).toBe(true);
    expect(input?.value).toBe("Contexto seguro");

    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(submitted).not.toHaveBeenCalled();
    expect(input?.value).toBe("Contexto seguro");

    Object.defineProperty(browserWindow.navigator, "onLine", { configurable: true, value: true });
    await act(async () => { browserWindow.dispatchEvent(new Event("online")); });

    expect(container.querySelector('[data-offline-notice]')).toBeNull();
    expect(button?.disabled).toBe(false);
    expect(input?.value).toBe("Contexto seguro");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(submitted).toHaveBeenCalledOnce();
  });
});
