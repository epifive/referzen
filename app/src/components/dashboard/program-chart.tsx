"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { listSeparator } from "@/lib/dash-format";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatCurrency, formatMoney } from "@/referral/normalize";

export interface ChartPoint {
  day: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
}

type Metric = "clicks" | "conversions" | "revenue";

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= v) return step * magnitude;
  return 10 * magnitude;
}

function fmtDay(day: string, locale: string, long = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions = long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
  try {
    return d.toLocaleDateString(locale, options);
  } catch {
    return d.toLocaleDateString("en", options);
  }
}

/** Daily clicks / conversions / revenue as bars, with a metric switch and hover tooltips. */
export function ProgramChart({ data, currency, locale }: { data: ChartPoint[]; currency: string; locale: string }) {
  const t = useT();
  const [metric, setMetric] = useState<Metric>("clicks");
  const value = (p: ChartPoint) => (metric === "clicks" ? p.clicks : metric === "conversions" ? p.conversions : p.revenueCents);
  const fmt = (v: number, compact = false) => {
    if (metric !== "revenue") return v.toLocaleString(locale);
    if (!compact) return formatMoney(v, currency, locale);
    try {
      return formatCurrency(v / 100, currency, locale, { notation: "compact", maximumFractionDigits: 1 });
    } catch {
      return formatMoney(v, currency, locale);
    }
  };
  const max = niceMax(Math.max(0, ...data.map(value)));
  const total = data.reduce((s, p) => s + value(p), 0);
  const edge = Math.max(2, Math.round(data.length * 0.15));
  const ticks = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0];
  const sep = listSeparator(locale);
  const labels: Record<Metric, string> = { clicks: t("dash.prog.kpi.clicks"), conversions: t("dash.prog.kpi.conversions"), revenue: t("dash.prog.kpi.revenue") };

  return (
    <figure aria-label={t("dash.prog.chartLabel", { metric: labels[metric] })}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Metric>
          value={metric}
          onChange={setMetric}
          label={t("dash.prog.chartMetric")}
          options={(["clicks", "conversions", "revenue"] as const).map((m) => ({ value: m, label: labels[m] }))}
        />
        <p className="text-sm text-muted">
          {t("dash.prog.chartTotal")}{" "}
          <bdi className="font-semibold text-ink tabular-nums">{fmt(total)}</bdi>
        </p>
      </div>
      <div className="flex gap-2">
        <div className="flex h-56 w-14 shrink-0 flex-col justify-between text-end text-[11px] text-muted tabular-nums" aria-hidden>
          <span className="-translate-y-1/2">{fmt(max, true)}</span>
          <span>{fmt(max / 2, true)}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-line" />
          </div>
          <ul className={cn("relative flex h-56 items-end", data.length > 45 ? "gap-px" : "gap-[3px]")}>
            {data.map((p, i) => {
              const v = value(p);
              const align = i < edge ? "start-0" : i >= data.length - edge ? "end-0" : "left-1/2 -translate-x-1/2";
              return (
                <li key={p.day} className="group relative flex h-full flex-1 items-end">
                  <span className="sr-only">
                    {fmtDay(p.day, locale, true)}: {[`${labels.clicks} ${p.clicks.toLocaleString(locale)}`, `${labels.conversions} ${p.conversions.toLocaleString(locale)}`, `${labels.revenue} ${formatMoney(p.revenueCents, currency, locale)}`].join(sep)}
                  </span>
                  <div className="absolute inset-0 rounded-sm group-hover:bg-primary-soft/60" aria-hidden />
                  <div
                    className={cn("relative w-full rounded-t-[3px] transition-colors", metric === "clicks" ? "bg-primary/70 group-hover:bg-primary" : metric === "conversions" ? "bg-sky-500/80 group-hover:bg-sky-500" : "bg-emerald-500/80 group-hover:bg-emerald-500")}
                    style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                    aria-hidden
                  />
                  <div className={cn("pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg group-hover:block", align)} aria-hidden>
                    <p className="font-medium">{fmtDay(p.day, locale, true)}</p>
                    <p className="mt-1 flex justify-between gap-4 text-muted">
                      {labels.clicks} <bdi className="font-medium text-ink tabular-nums">{p.clicks.toLocaleString(locale)}</bdi>
                    </p>
                    <p className="flex justify-between gap-4 text-muted">
                      {labels.conversions} <bdi className="font-medium text-ink tabular-nums">{p.conversions.toLocaleString(locale)}</bdi>
                    </p>
                    <p className="flex justify-between gap-4 text-muted">
                      {labels.revenue} <bdi className="font-medium text-ink tabular-nums">{formatMoney(p.revenueCents, currency, locale)}</bdi>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
            {ticks.map((i) => (
              <span key={i}>{fmtDay(data[i].day, locale)}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
