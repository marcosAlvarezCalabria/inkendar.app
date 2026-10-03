import { useEffect } from "react";
import { useNavigation, useRevalidator } from "react-router";

export const CONVERSATION_REFRESH_INTERVAL_MS = 10_000;

type AutoRefreshOptions = Readonly<{
  revalidate(): void | Promise<void>;
  isIdle(): boolean;
  intervalMs?: number;
}>;

export function startConversationAutoRefresh({
  revalidate,
  isIdle,
  intervalMs = CONVERSATION_REFRESH_INTERVAL_MS,
}: AutoRefreshOptions): () => void {
  let refreshPending = false;
  const refresh = () => {
    if (refreshPending || document.visibilityState === "hidden" || window.navigator.onLine === false || !isIdle()) return;
    refreshPending = true;
    try {
      void Promise.resolve(revalidate()).catch(() => undefined).finally(() => { refreshPending = false; });
    } catch {
      refreshPending = false;
    }
  };
  const timer = window.setInterval(refresh, intervalMs);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

export function ConversationAutoRefresh() {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  useEffect(() => startConversationAutoRefresh({
    revalidate: revalidator.revalidate,
    isIdle: () => navigation.state === "idle" && revalidator.state === "idle",
  }), [navigation.state, revalidator.revalidate, revalidator.state]);
  return null;
}
