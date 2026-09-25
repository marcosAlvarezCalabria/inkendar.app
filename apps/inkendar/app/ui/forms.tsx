import { useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type FieldControlProps = Readonly<{
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}>;

/**
 * Label above the control, optional hint and a field error tied by ID.
 * The caller renders the real control so names, types and defaults stay in the route.
 */
export function Field({ label, hint, error, children }: Readonly<{
  label: string;
  hint?: string;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
}>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  const control: FieldControlProps = {
    id,
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };

  return (
    <div className="field" data-invalid={error ? "" : undefined}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {hint ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      {children(control)}
      {error ? <p className="field-error" id={errorId}><span aria-hidden="true">×</span> {error}</p> : null}
    </div>
  );
}

/**
 * Submit control that states its intent while busy and blocks a second submission.
 * `pending` is derived by the route from navigation/fetcher state, never assumed.
 */
export function SubmitButton({ pending = false, pendingLabel, children, className, ...props }: Readonly<{
  pending?: boolean;
  pendingLabel: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">>) {
  return (
    <button
      {...props}
      className={className}
      type="submit"
      disabled={pending || props.disabled}
      {...(pending ? { "aria-busy": true, "data-pending": "" } : {})}
    >
      {pending ? <><span className="busy-mark" aria-hidden="true" />{pendingLabel}</> : children}
    </button>
  );
}
