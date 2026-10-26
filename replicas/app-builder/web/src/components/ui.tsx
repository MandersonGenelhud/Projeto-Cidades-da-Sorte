"use client";

import type { ButtonHTMLAttributes } from "react";
import type { JobStatus, Mode } from "@/lib/types";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_88%,black)]",
  secondary: "bg-surface border border-border hover:bg-surface-2",
  ghost: "bg-transparent hover:bg-surface-2",
  danger: "bg-danger text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,black)]",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3", md: "h-10 px-4" };

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; iconOnly?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${iconOnly ? (size === "sm" ? "size-8" : "size-10") : sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const options: [Mode, string][] = [
    ["build", "Construir"],
    ["plan", "Planejar"],
  ];
  return (
    <div role="radiogroup" aria-label="Modo" className="inline-flex gap-0.5 rounded-pill bg-surface-2 p-[3px]">
      {options.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          tabIndex={value === mode ? 0 : -1}
          onClick={() => onChange(mode)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              const next = value === "build" ? "plan" : "build";
              onChange(next);
              (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
            }
          }}
          data-mode={mode}
          className="rounded-pill px-3 py-1 text-xs font-semibold text-text-muted aria-checked:bg-surface aria-checked:text-text aria-checked:shadow-[0_1px_2px_rgba(0,0,0,.08)]"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const statusLabel: Record<JobStatus, string> = { idle: "Pronto", working: "Trabalhando", error: "Erro" };

export function StatusBadge({ status }: { status: JobStatus }) {
  const tone = {
    idle: "bg-success-soft text-success",
    working: "bg-working-soft text-working",
    error: "bg-danger-soft text-danger",
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      <span className={`size-1.5 rounded-full bg-current ${status === "working" ? "animate-pulse-soft" : ""}`} />
      {statusLabel[status]}
    </span>
  );
}

export function StatusDot({ status }: { status: JobStatus }) {
  const tone = { idle: "bg-success", working: "bg-working animate-pulse-soft", error: "bg-danger" }[status];
  return <span className={`size-2 shrink-0 rounded-full ${tone}`} role="img" aria-label={statusLabel[status]} />;
}
