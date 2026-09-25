import type { ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "pending";

/** Every tone carries a glyph and text so no state depends on color alone. */
const glyphs: Record<Tone, string> = {
  neutral: "•",
  info: "i",
  success: "✓",
  warning: "!",
  danger: "×",
  pending: "…",
};

export function StatusBadge({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
  return (
    <span className="stamp" data-tone={tone}>
      <span className="stamp-glyph" aria-hidden="true">{glyphs[tone]}</span>
      <span>{children}</span>
    </span>
  );
}

/**
 * Inline feedback and attention banners. Errors interrupt (`role="alert"`);
 * success, progress and warnings are announced politely (`role="status"`).
 */
export function Notice({ tone, title, children, action }: Readonly<{
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <span className="notice-glyph" aria-hidden="true">{glyphs[tone]}</span>
      <div className="notice-body">
        <p className="notice-title">{title}</p>
        {children ? <div className="notice-text">{children}</div> : null}
      </div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: Readonly<{
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children ? <p className="empty-state-text">{children}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

/** Structured placeholder with a named section; never an isolated, unlabelled spinner. */
export function LoadingState({ label, rows = 3 }: Readonly<{ label: string; rows?: number }>) {
  return (
    <div className="loading-state" aria-busy="true">
      <p className="loading-label">{label}</p>
      <div className="skeleton-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => <span className="skeleton" key={index} />)}
      </div>
    </div>
  );
}

/** Full-page state for denied access, unavailable areas and invalid public links. */
export function StatusPage({ tone, title, children, action }: Readonly<{
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <main className="status-page">
      <div className="sheet status-sheet" data-tone={tone}>
        <p className="brand-line"><BrandMark /> Inkendar</p>
        <h1>{title}</h1>
        {children ? <p>{children}</p> : null}
        {action ? <div className="status-action">{action}</div> : null}
      </div>
    </main>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="6" height="18" rx="1" />
      <rect x="14" y="3" width="6" height="18" rx="1" />
    </svg>
  );
}
