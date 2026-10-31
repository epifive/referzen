import { BadgeDollarSign, Copy, TrendingUp } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { areaPaths, exampleSeries } from "./chart";
import { EXAMPLE_AFFILIATES, initials, money, num } from "./format";

const CHART_W = 640;
const CHART_H = 120;

/** Brand-coloured dot + name of a conversion source. */
const SOURCES = {
  stripe: { name: "Stripe", dot: "bg-[#635bff]" },
  woocommerce: { name: "WooCommerce", dot: "bg-[#7f54b3]" },
  shopify: { name: "Shopify", dot: "bg-[#5e8e3e]" },
} as const;

/** Window chrome around an app illustration: traffic lights, address and extras on the end side. */
export function WindowFrame({
  address,
  extra,
  children,
  className,
}: {
  address: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(131,24,67,0.55)] ring-1 ring-black/[0.02] dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line bg-paper/70 px-4 py-2.5">
        <span aria-hidden className="flex shrink-0 gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span dir="ltr" className="min-w-0 truncate font-display text-sm font-semibold">
          {address}
        </span>
        {extra ? <span className="ms-auto flex shrink-0 items-center gap-2">{extra}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Avatar({ name, tone, className }: { name: string; tone: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white", tone, className)}>
      {initials(name)}
    </span>
  );
}

/**
 * The hero illustration: an example merchant dashboard (KPIs, referred revenue, top affiliates,
 * latest conversions) with an affiliate-portal card and a "new conversion" toast floating around it.
 * Plain HTML/SVG: no JavaScript.
 */
export function HeroMockup({ t, site, locale, currency }: { t: Translator; site: string; locale: string; currency: string }) {
  const m = (cents: number) => money(cents, currency, locale);
  const series = exampleSeries(30, 520, 3);
  const { line, area, peak } = areaPaths(series, CHART_W, CHART_H, 10);
  const kpis = [
    { label: t("home.mock.clicks"), value: num(12480, locale), change: 18 },
    { label: t("home.mock.conversions"), value: num(342, locale), change: 24 },
    { label: t("home.mock.revenue"), value: m(1675800), change: 21 },
    { label: t("home.mock.owed"), value: m(335200), change: 19 },
  ];
  const latest = [
    { amount: 4900, source: SOURCES.stripe, approved: false },
    { amount: 12900, source: SOURCES.shopify, approved: false },
    { amount: 7900, source: SOURCES.woocommerce, approved: true },
    { amount: 4900, source: SOURCES.stripe, approved: true },
  ];
  const bars = [32, 46, 38, 58, 44, 66, 52, 74, 61, 88, 70, 96];

  return (
    <div role="img" aria-label={t("home.mock.label", { site })} className="relative mx-auto w-full max-w-[640px] select-none">
      <div aria-hidden className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/30 via-amber-400/15 to-transparent blur-3xl" />

      <WindowFrame
        address="acme.com"
        className="animate-tz-pop motion-reduce:animate-none"
        extra={
          <>
            <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted max-[420px]:hidden">{t("home.mock.period")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70 motion-reduce:animate-none" />
                <span className="relative size-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("home.mock.live")}
            </span>
          </>
        }
      >
        <div className="space-y-3 p-3 sm:p-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {kpis.map((k, i) => (
              <div
                key={k.label}
                className={cn(
                  "relative flex min-w-0 flex-col-reverse justify-end rounded-xl border px-3 py-2.5",
                  i === 3 ? "border-primary-line bg-primary-soft" : "border-line bg-paper/60",
                )}
              >
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                  <bdi className="font-display text-lg font-bold tracking-tight tabular-nums sm:text-xl">{k.value}</bdi>
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 sm:text-[11px] dark:text-emerald-400">
                    <TrendingUp className="size-3" aria-hidden />
                    <bdi dir="ltr">+{k.change}%</bdi>
                  </span>
                </dd>
                <dt className="truncate text-[10px] font-medium text-muted sm:text-[11px]">{k.label}</dt>
                {i === 3 ? <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-line bg-paper/60 p-3">
            <p className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-muted">
              <span>{t("home.mock.chart")}</span>
              <bdi className="font-display text-sm text-ink tabular-nums">{m(1675800)}</bdi>
            </p>
            <div className="relative mt-2 h-24">
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                <defs>
                  <linearGradient id="rz-hero-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="var(--primary)" stopOpacity="0.32" />
                    <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1="0" x2={CHART_W} y1={CHART_H * f} y2={CHART_H * f} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={area} fill="url(#rz-hero-area)" />
                <path
                  d={line}
                  pathLength={1}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  className="animate-[rz-draw_1.6s_ease-out_0.2s_both] [stroke-dasharray:1] motion-reduce:animate-none"
                />
              </svg>
              {peak ? (
                <span
                  aria-hidden
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)]"
                  style={{ left: `${(peak[0] / CHART_W) * 100}%`, top: `${(peak[1] / CHART_H) * 100}%` }}
                />
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-line p-3 max-sm:hidden">
              <p className="text-[11px] font-semibold text-ink">{t("home.mock.latest")}</p>
              <ul className="mt-2 space-y-1.5">
                {latest.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-paper/60 px-2 py-1.5 text-[12px]">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", c.source.dot)} />
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-muted">
                      {c.source.name}
                    </span>
                    <bdi className="shrink-0 font-semibold tabular-nums">{m(c.amount)}</bdi>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-px text-[9px] font-bold",
                        c.approved ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {c.approved ? t("home.mock.approved") : t("home.mock.pending")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 rounded-xl border border-line p-3">
              <p className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-muted">
                <span className="truncate text-ink">{t("home.mock.topAffiliates")}</span>
                <span className="shrink-0">{t("home.mock.earned")}</span>
              </p>
              <ul className="mt-2 space-y-1.5">
                {EXAMPLE_AFFILIATES.map((a) => (
                  <li key={a.name} className="flex items-center gap-2 text-[12px]">
                    <Avatar name={a.name} tone={a.tone} />
                    <span className="min-w-0 flex-1">
                      <bdi dir="auto" className="block truncate font-semibold">
                        {a.name}
                      </bdi>
                      <span className="block text-[10px] text-muted">{t("home.mock.sales", { n: num(a.sales, locale) })}</span>
                    </span>
                    <bdi className="shrink-0 font-semibold tabular-nums">{m(a.earned)}</bdi>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </WindowFrame>

      {/* "New conversion" toast. Anchored by its bottom edge: a wrapped translation grows upwards. */}
      <div
        aria-hidden
        className="absolute -end-4 bottom-[calc(100%+0.75rem)] z-10 hidden w-[300px] animate-[rz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_1.2s_both] items-start gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)] backdrop-blur motion-reduce:animate-none lg:flex xl:-end-8 dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500 text-white">
          <BadgeDollarSign className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-start text-[13px] leading-snug font-semibold">{t("home.mock.toastTitle", { amount: m(4900) })}</span>
            <span className="shrink-0 pt-0.5 text-[10px] text-muted">{t("home.mock.now")}</span>
          </span>
          <span className="mt-0.5 block text-start text-[11px] leading-snug text-muted">{t("home.mock.toastText", { name: "Maya Chen" })}</span>
        </span>
      </div>

      {/* The affiliate's side of the same sale: their portal card. */}
      <div
        aria-hidden
        className="absolute -start-12 -bottom-20 z-10 hidden w-[260px] animate-[rz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.8s_both] rounded-2xl border border-line bg-surface/95 p-4 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.4)] backdrop-blur motion-reduce:animate-none lg:block xl:-start-20 dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.85)]"
      >
        <span className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-primary font-display text-[11px] font-bold text-white">A</span>
          <span className="text-[11px] font-semibold text-muted">{t("home.mock.portal")}</span>
          <Avatar name="Maya Chen" tone={EXAMPLE_AFFILIATES[0].tone} className="ms-auto size-6" />
        </span>
        <span className="mt-3 block text-[10px] font-semibold text-muted">{t("home.mock.yourLink")}</span>
        <span className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5">
          <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-[11px]">
            acme.com/?ref=maya
          </span>
          <Copy className="size-3.5 shrink-0 text-primary-text" aria-hidden />
        </span>
        <span className="mt-3 flex items-end justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold text-muted">{t("home.mock.earned")}</span>
            <bdi className="block font-display text-2xl font-bold tracking-tight tabular-nums">{m(117600)}</bdi>
            <span className="mt-0.5 inline-flex rounded-md bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {t("home.mock.pendingAmount", { amount: m(29400) })}
            </span>
          </span>
          <span className="flex h-10 shrink-0 items-end gap-[3px]">
            {bars.map((h, i) => (
              <span key={i} className={cn("w-1.5 rounded-sm", i === bars.length - 1 ? "bg-primary" : "bg-primary/30")} style={{ height: `${h}%` }} />
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}
