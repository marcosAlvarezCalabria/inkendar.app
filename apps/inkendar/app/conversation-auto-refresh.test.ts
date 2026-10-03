// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { startConversationAutoRefresh } from "./conversation-auto-refresh.js";

const INTERVAL_MS = 10_000;

describe("conversation auto refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    setOnline(true);
    setVisibility("visible");
  });

  it("revalidates periodically only while visible, online and idle", () => {
    vi.useFakeTimers();
    const revalidate = vi.fn();
    let idle = true;
    const stop = startConversationAutoRefresh({ revalidate, isIdle: () => idle, intervalMs: INTERVAL_MS });

    vi.advanceTimersByTime(INTERVAL_MS);
    expect(revalidate).toHaveBeenCalledTimes(1);

    idle = false;
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(revalidate).toHaveBeenCalledTimes(1);

    idle = true;
    setOnline(false);
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(revalidate).toHaveBeenCalledTimes(1);

    setOnline(true);
    setVisibility("hidden");
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(revalidate).toHaveBeenCalledTimes(1);

    stop();
  });

  it("revalidates immediately after connectivity or visibility returns and cleans up", () => {
    vi.useFakeTimers();
    const revalidate = vi.fn();
    setOnline(false);
    setVisibility("hidden");
    const stop = startConversationAutoRefresh({ revalidate, isIdle: () => true, intervalMs: INTERVAL_MS });

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(revalidate).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(revalidate).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not overlap refreshes while the previous revalidation is pending", async () => {
    let finish: (() => void) | undefined;
    const revalidate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startConversationAutoRefresh({ revalidate, isIdle: () => true, intervalMs: INTERVAL_MS });

    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(revalidate).toHaveBeenCalledTimes(1);

    finish?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(revalidate).toHaveBeenCalledTimes(2);
    stop();
  });
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}
