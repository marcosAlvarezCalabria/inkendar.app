import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type ServiceWorkerNavigator = Readonly<{
  serviceWorker?: Readonly<{
    register(scriptURL: string, options?: RegistrationOptions): Promise<unknown>;
  }>;
}>;

const SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';

export async function registerServiceWorker(browserNavigator: ServiceWorkerNavigator): Promise<void> {
  if (!browserNavigator.serviceWorker) return;
  await browserNavigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Browser-only connectivity boundary. It never stores application data: it
 * announces stale state and blocks non-GET submissions until connectivity is
 * restored, while preserving every form control value in the document.
 */
export function OfflineBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const [online, setOnline] = useState(true);
  const onlineRef = useRef(true);

  useEffect(() => {
    void registerServiceWorker(window.navigator).catch(() => undefined);
  }, []);

  useEffect(() => {
    function updateConnection() {
      const nextOnline = window.navigator.onLine !== false;
      onlineRef.current = nextOnline;
      setOnline(nextOnline);
    }

    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    function mutationControls(): Array<HTMLButtonElement | HTMLInputElement> {
      return Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(SUBMIT_SELECTOR))
        .filter((control) => control.form?.method.toLowerCase() !== "get");
    }

    function syncMutationControls() {
      for (const control of mutationControls()) {
        if (!online && control.dataset.offlineBlocked === undefined) {
          control.dataset.offlineBlocked = "";
          control.dataset.offlineWasDisabled = control.disabled ? "true" : "false";
        }
        if (!online && !control.disabled) {
          control.disabled = true;
        }
        if (online && control.dataset.offlineBlocked !== undefined) {
          control.disabled = control.dataset.offlineWasDisabled === "true";
          delete control.dataset.offlineBlocked;
          delete control.dataset.offlineWasDisabled;
        }
      }
    }

    syncMutationControls();
    const observer = new window.MutationObserver(syncMutationControls);
    observer.observe(document.body, { attributes: true, attributeFilter: ["disabled"], childList: true, subtree: true });

    return () => {
      observer.disconnect();
      for (const control of mutationControls()) {
        if (control.dataset.offlineBlocked === undefined) continue;
        control.disabled = control.dataset.offlineWasDisabled === "true";
        delete control.dataset.offlineBlocked;
        delete control.dataset.offlineWasDisabled;
      }
    };
  }, [online]);

  useEffect(() => {
    function blockOfflineMutation(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof window.HTMLFormElement)) return;
      if (form.method.toLowerCase() === "get") return;
      if (onlineRef.current && window.navigator.onLine !== false) return;
      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("submit", blockOfflineMutation, true);
    return () => document.removeEventListener("submit", blockOfflineMutation, true);
  }, []);

  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite">
        {online ? "Con conexión." : "Sin conexión."}
      </p>
      {!online ? (
        <aside className="offline-notice" data-offline-notice="" role="status">
          <strong>Sin conexión</strong>
          <span>Los datos pueden no estar actualizados. Reconecta antes de enviar cambios.</span>
        </aside>
      ) : null}
      {children}
    </>
  );
}
