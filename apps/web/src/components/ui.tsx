import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-mute text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className = "", right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`panel p-4 ${className}`} aria-label={title}>
      {title && (
        <div className="flex items-center mb-3">
          <h2 className="panel-h">{title}</h2>
          {right && <div className="ml-auto">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Honest empty state: says what's missing and what fills it. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-line rounded-lg px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-mute text-sm mt-1 max-w-xl mx-auto">{children}</div>}
    </div>
  );
}

type Tone = "neutral" | "pos" | "neg" | "warn" | "accent";
const TONES: Record<Tone, string> = {
  neutral: "border-line text-mute",
  pos: "border-pos/40 text-pos",
  neg: "border-neg/40 text-neg",
  warn: "border-warn/40 text-warn",
  accent: "border-accent/40 text-accent",
};
export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`chip ${TONES[tone]}`} title={title}>{children}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="panel border-neg/50 p-4 text-sm">
      <p className="font-medium text-neg">Couldn't load data</p>
      <p className="text-mute mt-1">{error instanceof Error ? error.message : String(error)}</p>
    </div>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
