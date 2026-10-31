import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Building blocks of the affiliate portal pages (server components). */

export function PortalSection({ title, description, actions, children, className, id, padded = true }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; padded?: boolean }) {
  return (
    <section id={id} className={cn("rounded-xl border border-line bg-surface", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="font-sans text-base font-semibold tracking-normal">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, emphasis = false }: { label: string; value: ReactNode; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-surface p-4", emphasis ? "border-primary-line" : "border-line")}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1.5 font-display text-2xl font-bold tabular-nums", emphasis && "text-primary-text")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const STATUS_TONE = {
  pending: "warning",
  approved: "primary",
  paid: "success",
  reversed: "danger",
  draft: "neutral",
} as const;

export function StatusBadge({ status, label }: { status: keyof typeof STATUS_TONE; label: string }) {
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}

/**
 * `mobileMinWidth` (default: minWidth) applies below the sm breakpoint: tables that hide their
 * less important columns on phones (max-sm:hidden) pass 0 and fit the screen.
 */
export function PortalTable({ children, minWidth = 560, mobileMinWidth = minWidth }: { children: ReactNode; minWidth?: number; mobileMinWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-(--table-min-mobile) text-start text-sm sm:min-w-(--table-min)" style={{ "--table-min": `${minWidth}px`, "--table-min-mobile": `${mobileMinWidth}px` } as CSSProperties}>
        {children}
      </table>
    </div>
  );
}

export function PTh({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("border-b border-line bg-paper px-4 py-2.5 text-xs font-medium text-muted first:ps-5 last:pe-5", /\btext-(end|center|right|left)\b/.test(className ?? "") ? undefined : "text-start", className)}>
      {children}
    </th>
  );
}

export function PTd({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle first:ps-5 last:pe-5", className)}>{children}</td>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{children}</p>;
}
