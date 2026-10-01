import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import type { ComponentProps } from "react";
import type * as ReactRouter from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, Form: ({ reloadDocument, ...props }: ComponentProps<"form"> & { reloadDocument?: boolean }) => <form data-submission-mode={reloadDocument ? "document" : "client"} {...props} /> };
});

import { PublicAvailabilityView } from "./routes/public-availability.js";
import { PublicOfferView } from "./routes/public-offer.js";
import { formatPublicDateTime } from "./ui/public-booking.js";
import {
  availabilityStates,
  confirmedOffer,
  emptyAvailability,
  openAvailabilityAtDayBoundary,
  openOfferAtDayBoundary,
  pendingOffer,
} from "./ui/fixtures/public-booking.js";

describe("public booking presentation", () => {
  function render(view: ReactNode) { return renderToStaticMarkup(<MemoryRouter>{view}</MemoryRouter>); }
  it("formats an offer in its IANA zone across a UTC day boundary", () => {
    const local = formatPublicDateTime("2026-01-01T00:30:00.000Z", "America/Los_Angeles");
    const utc = formatPublicDateTime("2026-01-01T00:30:00.000Z", null);

    expect(local).toMatch(/31 dic 2025/u);
    expect(local).toContain("16:30");
    expect(utc).toMatch(/1 ene 2026/u);
    expect(utc).toContain("UTC");
  });

  it("renders one to three provisional offer choices with only the chosen action pending", () => {
    const pendingSelector = openOfferAtDayBoundary.options[1]!.selector;
    const html = render(<PublicOfferView data={openOfferAtDayBoundary} pendingSelector={pendingSelector} />);

    expect(html.match(/Elegir esta opción/gu)).toHaveLength(2);
    expect(html).toContain("Eligiendo…");
    expect(html.match(/disabled=""/gu)).toHaveLength(1);
    expect(html).toContain("31 dic 2025");
    expect(html).toContain("America/Los_Angeles");
    expect(html).toContain("bloqueadas solo de forma temporal");
    expect(html).not.toContain("Cita confirmada");
  });

  it.each([
    [undefined, "Puedes volver a comprobar la confirmación con seguridad."],
    ["CONFLICT", "El horario requiere revisión del estudio."],
    ["RECONNECT", "El estudio debe reconectar su calendario."],
    ["REVIEW_REQUIRED", "El estudio debe revisar el resultado antes de continuar."],
    ["RETRY", "No pudimos contactar con el calendario."],
  ] as const)("keeps a pending offer honest for reason %s", (reason, expected) => {
    const html = render(<PublicOfferView data={pendingOffer} {...(reason ? { actionResult: { state: "SELECTION_PENDING_CONFIRMATION" as const, reason } } : {})} />);
    expect(html).toContain("Selección recibida");
    expect(html).toContain(expected);
    expect(html).toContain('name="intent"');
    expect(html).toContain('value="confirm"');
    expect(html).not.toContain("Cita confirmada");
  });

  it("claims success only for the confirmed offer state", () => {
    const html = render(<PublicOfferView data={confirmedOffer} />);
    expect(html).toContain("Cita confirmada");
    expect(html).toContain("Confirmada");
    expect(html).not.toMatch(/<form/u);
  });

  it("renders free-choice candidates as requests and blocks only the chosen document submit", () => {
    const pendingSelector = openAvailabilityAtDayBoundary.slots[2]!.selector;
    const html = render(<PublicAvailabilityView data={openAvailabilityAtDayBoundary} pendingSelector={pendingSelector} />);

    expect(html.match(/Solicitar este hueco/gu)).toHaveLength(2);
    expect(html).toContain("Solicitando…");
    expect(html.match(/disabled=""/gu)).toHaveLength(1);
    expect(html.match(/action="select"/gu)).toHaveLength(3);
    expect(html).toContain("requiere aprobación");
    expect(html).not.toMatch(/reservar|Reserva confirmada/iu);
  });

  it("renders a clear free-choice empty state", () => {
    const html = render(<PublicAvailabilityView data={emptyAvailability} />);
    expect(html).toContain("No hay huecos para solicitar ahora");
    expect(html).toContain("El estudio puede compartirte otro enlace");
    expect(html).not.toMatch(/<form/u);
  });

  it.each([
    [availabilityStates[0]!, "Pendiente de aprobación", "Solicitud recibida"],
    [availabilityStates[1]!, "En comprobación", "El estudio está comprobando"],
    [availabilityStates[2]!, "Confirmada", "Cita confirmada"],
    [availabilityStates[3]!, "No aceptada", "no fue aceptada"],
    [availabilityStates[4]!, "Caducada", "ya no está vigente"],
  ] as const)("gives state %s an honest status and next step", (data, badge, message) => {
    const html = render(<PublicAvailabilityView data={data} />);
    expect(html).toContain(badge);
    expect(html).toContain(message);
    expect(html).not.toMatch(/te avisaremos|recibirás una notificación/iu);
  });
});
