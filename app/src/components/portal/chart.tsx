import { cn } from "@/lib/utils";

export interface BarPoint {
  day: string;
  value: number;
  /** Pre-formatted tooltip: title (date) and lines (metric values). */
  tip: { title: string; lines: string[] };
}

/**
 * One metric per day as bars (single series, one axis). Pure HTML/CSS: hover or focus a day
 * for its numbers; the page renders the same data as a table for screen readers.
 */
export function DailyBars({
  data,
  label,
  formatValue,
  ticks,
  emptyText,
  separator = ", ",
}: {
  data: BarPoint[];
  label: string;
  /** Pre-formatted axis values: [max, half]. */
  formatValue: [string, string];
  /** Labels under the axis: start, middle, end. */
  ticks: [string, string, string];
  emptyText: string;
  /** Joins the tooltip lines in the screen-reader text (listSeparator(locale)). */
  separator?: string;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const edge = Math.max(2, Math.round(data.length * 0.15));
  return (
    <figure aria-label={label}>
      <div className="flex gap-2">
        <div className="flex h-48 w-14 shrink-0 flex-col justify-between text-end text-[11px] text-muted tabular-nums" aria-hidden>
          <span className="-translate-y-1/2">{formatValue[0]}</span>
          <span>{formatValue[1]}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative h-48 min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-line" />
          </div>
          {max === 0 ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted">{emptyText}</p>
          ) : null}
          <ul className={cn("absolute inset-0 flex items-end", data.length > 45 ? "gap-px" : "gap-[2px]")}>
            {data.map((d, i) => {
              const align = i < edge ? "start-0" : i >= data.length - edge ? "end-0" : "left-1/2 -translate-x-1/2";
              const pct = max > 0 ? (d.value / max) * 100 : 0;
              return (
                <li key={d.day} className="group relative flex h-full flex-1 items-end">
                  <span className="sr-only">
                    {d.tip.title}: {d.tip.lines.join(separator)}
                  </span>
                  <div
                    className={cn("w-full rounded-t-[4px] transition-colors", d.value > 0 ? "bg-primary/80 group-hover:bg-primary" : "bg-transparent")}
                    style={{ height: d.value > 0 ? `max(${pct}%, 3px)` : 0 }}
                    aria-hidden
                  />
                  <div className="absolute inset-y-0 left-1/2 -z-0 hidden w-px -translate-x-1/2 bg-primary/25 group-hover:block" aria-hidden />
                  <div
                    className={cn("pointer-events-none absolute top-0 z-10 hidden w-max max-w-56 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg group-hover:block", align)}
                    aria-hidden
                  >
                    <p className="font-medium">{d.tip.title}</p>
                    {d.tip.lines.map((line) => (
                      <p key={line} className="mt-0.5 text-muted">
                        {line}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="mt-2 flex justify-between ps-16 text-[11px] text-muted" aria-hidden>
        <span>{ticks[0]}</span>
        <span>{ticks[1]}</span>
        <span>{ticks[2]}</span>
      </div>
    </figure>
  );
}
