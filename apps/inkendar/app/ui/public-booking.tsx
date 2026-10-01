import type { ReactNode } from "react";

import { StatusBadge, type Tone } from "./feedback.js";

export function PublicHeading({ title, label, tone }: Readonly<{ title: string; label: string; tone: Tone }>) {
  return <div className="public-heading"><h1>{title}</h1><StatusBadge tone={tone}>{label}</StatusBadge></div>;
}

export function PublicMeta({ timeZone, expiresAt, expiryLabel = "Disponible hasta" }: Readonly<{
  timeZone: string;
  expiresAt?: string;
  expiryLabel?: string;
}>) {
  return <dl className="public-meta">
    <div><dt>Zona horaria</dt><dd>{timeZone}</dd></div>
    {expiresAt ? <div><dt>{expiryLabel}</dt><dd><PublicDateTime value={expiresAt} timeZone={timeZone} /></dd></div> : null}
  </dl>;
}

export function PublicInterval({ startUtc, endUtc, timeZone }: Readonly<{ startUtc: string; endUtc: string; timeZone: string | null }>) {
  return <p className="slot-time">
    <PublicDateTime value={startUtc} timeZone={timeZone} />
    <span aria-hidden="true"> → </span><span className="sr-only"> hasta </span>
    <PublicDateTime value={endUtc} timeZone={timeZone} />
  </p>;
}

export function PublicState({ title, label, tone, children }: Readonly<{
  title: string;
  label: string;
  tone: Tone;
  children: ReactNode;
}>) {
  return <><PublicHeading title={title} label={label} tone={tone} /><div className="public-state-copy">{children}</div></>;
}

export function PublicDateTime({ value, timeZone }: Readonly<{ value: string; timeZone: string | null }>) {
  return <time dateTime={value}>{formatPublicDateTime(value, timeZone)}</time>;
}

export function formatPublicDateTime(dateTime: string, timeZone: string | null): string {
  const zone = publicTimeZone(timeZone);
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
    ...(zone === "UTC" ? { timeZoneName: "short" as const } : {}),
  }).format(new Date(dateTime));
}

export function publicTimeZone(timeZone: string | null): string { return timeZone ?? "UTC"; }
