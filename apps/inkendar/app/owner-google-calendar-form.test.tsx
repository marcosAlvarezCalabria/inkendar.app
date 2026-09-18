import type { ComponentProps } from "react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Window } from "happy-dom";
import type * as ReactRouterModule from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitted = vi.hoisted(() => vi.fn<(form: FormData) => void>());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    Form: ({ children, ...props }: ComponentProps<"form">) => (
      <form
        data-router-form=""
        {...props}
        onSubmit={(event) => {
          event.preventDefault();
          submitted(new FormData(event.currentTarget));
        }}
      >
        {children}
      </form>
    ),
  };
});

import { CalendarManagement } from "./routes/owner-calendars.js";

const artistId = "50000000-0000-4000-8000-000000000001";
const calendarId = "inkendar-local-artist@example.test";
const data = {
  connectionStatus: "ACTIVE" as const,
  calendars: [{
    id: calendarId,
    summary: "Inkendar · Local Artist",
    timeZone: "Europe/Dublin",
    accessRole: "owner" as const,
    primary: false,
  }],
  artists: [{ id: artistId, displayName: "Gallery Live Artist", calendarId: null }],
};

describe("owner calendar assignment form", () => {
  let happyWindow: Window;
  let browserWindow: globalThis.Window;
  let root: ReturnType<typeof hydrateRoot> | undefined;

  beforeEach(() => {
    happyWindow = new Window({ url: "https://app.inkendar.es/app/owner/calendars" });
    browserWindow = happyWindow as unknown as globalThis.Window;
    Object.assign(globalThis, {
      window: browserWindow,
      document: browserWindow.document,
      HTMLElement: happyWindow.HTMLElement,
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

  it("posts the selected calendar before and after hydration, and clears it only intentionally", async () => {
    const container = browserWindow.document.createElement("div");
    container.innerHTML = renderToString(<CalendarManagement data={data} result={null} />);
    browserWindow.document.body.append(container);

    const form = assignmentForm(container);
    const select = form.elements.namedItem("calendarId") as HTMLSelectElement;
    select.value = calendarId;

    const nativeData = new FormData(form);
    expect(nativeData.get("artistProfileId")).toBe(artistId);
    expect(nativeData.get("calendarId")).toBe(calendarId);

    await act(async () => {
      root = hydrateRoot(container, <CalendarManagement data={data} result={null} />);
    });

    select.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(submitted).toHaveBeenLastCalledWith(expect.any(FormData));
    expect(submitted.mock.calls.at(-1)?.[0].get("calendarId")).toBe(calendarId);

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(submitted.mock.calls.at(-1)?.[0].get("calendarId")).toBe("");
  });

  it("renders a persisted assignment as the selected calendar after redirect", () => {
    const container = browserWindow.document.createElement("div");
    container.innerHTML = renderToString(<CalendarManagement
      data={{ ...data, artists: [{ id: artistId, displayName: "Gallery Live Artist", calendarId }] }}
      result="assignment-saved"
    />);

    const form = assignmentForm(container);
    expect((form.elements.namedItem("calendarId") as HTMLSelectElement).value).toBe(calendarId);
    expect(container.textContent).toContain("Asignación guardada.");
  });
});

function assignmentForm(container: HTMLElement): HTMLFormElement {
  const input = container.querySelector<HTMLInputElement>('input[name="intent"][value="assign"]');
  if (!input?.form) throw new Error("Missing calendar assignment form");
  return input.form;
}
