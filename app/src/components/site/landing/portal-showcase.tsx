import Link from "next/link";
import { ArrowRight, Check, Copy, Wallet } from "lucide-react";
import { interpolateParts, type Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { exampleSeries } from "./chart";
import { money, num, pct } from "./format";
import { Avatar, WindowFrame } from "./hero-mockup";
import { SectionHeading } from "./section-heading";

export interface ShowcaseProgram {
  name: string;
  href: string;
  /** Translated commission ("30% recurring for 12 months"). */
  rate: string;
}

/** The affiliate's side: a branded portal illustration and, when a showcase program exists, a link to it. */
export function PortalShowcase({
  t,
  locale,
  currency,
  host,
  live,
}: {
  t: Translator;
  locale: string;
  currency: string;
  /** Host of this site, shown in the illustration's address bar. */
  host: string;
  live: ShowcaseProgram | null;
}) {
  const m = (cents: number) => money(cents, currency, locale);
  const bullets = [t("home.portal.b1"), t("home.portal.b2"), t("home.portal.b3"), t("home.portal.b4")];
  const bars = exampleSeries(30, 40, 4);
  const maxBar = Math.max(...bars);
  const nav = [t("portal.nav.overview"), t("portal.nav.links"), t("portal.nav.earnings"), t("portal.nav.assets")];
  const kpis = [
    { label: t("portal.kpi.clicks"), value: num(1284, locale) },
    { label: t("portal.kpi.conversions"), value: num(48, locale) },
    { label: t("portal.kpi.earned"), value: m(117600), strong: true },
  ];

  return (
    <section id="portal" aria-labelledby="portal-title" className="relative scroll-mt-16 overflow-hidden border-y border-line bg-surface py-24 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute -start-40 top-1/3 size-[460px] rounded-full bg-primary/12 blur-[120px]" />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <SectionHeading id="portal-title" eyebrow={t("home.portal.eyebrow")} title={t("home.portal.title")} text={t("home.portal.text")} />
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
          {live ? (
            <div className="mt-9">
              <Link
                href={live.href}
                prefetch={false}
                className="group inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 font-semibold text-paper transition-opacity hover:opacity-90"
              >
                {t("home.portal.visit")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </Link>
              <p className="mt-3 text-sm text-muted">
                {interpolateParts(t("home.portal.live"), {
                  program: <bdi key="p" className="font-semibold text-ink">{live.name}</bdi>,
                  rate: <bdi key="r">{live.rate}</bdi>,
                })}
              </p>
            </div>
          ) : null}
        </div>

        <div role="img" aria-label={t("home.portal.label")} className="relative min-w-0 select-none">
          <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/25 via-fuchsia-400/10 to-transparent blur-3xl" />
          <WindowFrame address={`${host}${live ? live.href : "/a/acme"}`}>
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-display text-base font-bold text-white">A</span>
              <span className="font-display font-bold">Acme Cloud</span>
              <span className="ms-auto flex items-center gap-1 text-[12px] font-medium">
                {nav.map((item, i) => (
                  <span
                    key={item}
                    className={cn(
                      "rounded-md px-2 py-1",
                      i === 0 ? "bg-primary-soft text-primary-text" : "text-muted",
                      i >= 2 && "max-md:hidden",
                      i === 1 && "max-[420px]:hidden",
                    )}
                  >
                    {item}
                  </span>
                ))}
              </span>
              <Avatar name="Maya Chen" tone="from-pink-500 to-rose-600" className="max-sm:hidden" />
            </div>

            <div className="space-y-3 p-3 sm:p-4">
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary to-[color-mix(in_oklab,var(--primary)_70%,#7c3aed)] px-4 py-3.5 text-white">
                <div aria-hidden className="absolute -end-8 -top-10 size-32 rounded-full bg-white/15 blur-2xl" />
                <p className="relative text-sm font-semibold">{t("home.portal.offer", { rate: pct(0.3, locale) })}</p>
                <div className="relative mt-2.5 flex items-center gap-2 rounded-lg bg-white/15 p-1 ps-3 ring-1 ring-white/25 ring-inset">
                  <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-[12px]">
                    acme.com/?ref=maya
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-primary">
                    <Copy className="size-3" aria-hidden />
                    {t("ui.copy")}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-2">
                {kpis.map((k) => (
                  <div key={k.label} className={cn("flex min-w-0 flex-col-reverse justify-end rounded-xl border px-3 py-2.5", k.strong ? "border-primary-line bg-primary-soft" : "border-line bg-paper/60")}>
                    <dd className="mt-0.5">
                      <bdi className="block truncate font-display text-base font-bold tracking-tight tabular-nums sm:text-xl">{k.value}</bdi>
                    </dd>
                    <dt className="truncate text-[10px] font-medium text-muted sm:text-[11px]">{k.label}</dt>
                  </div>
                ))}
              </dl>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <div className="rounded-xl border border-line bg-paper/60 p-3">
                  <p className="text-[11px] font-semibold text-muted">{t("portal.kpi.title", { days: 30 })}</p>
                  <div aria-hidden className="mt-2 flex h-20 items-end gap-[3px]">
                    {bars.map((v, i) => (
                      <span
                        key={i}
                        className={cn("flex-1 rounded-t-[3px]", i === bars.length - 1 ? "bg-primary" : "bg-primary/35 dark:bg-primary/45")}
                        style={{ height: `${Math.max(8, (v / maxBar) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col justify-between rounded-xl border border-line p-3">
                  <span className="flex items-center gap-2 text-[11px] font-semibold text-muted">
                    <span className="grid size-6 place-items-center rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                      <Wallet className="size-3.5" aria-hidden />
                    </span>
                    {t("home.portal.payout")}
                  </span>
                  <span className="mt-3 block">
                    <bdi className="block font-display text-2xl font-bold tracking-tight tabular-nums">{m(29400)}</bdi>
                    <span className="text-[11px] text-muted">{t("home.portal.payoutVia")}</span>
                  </span>
                </div>
              </div>
            </div>
          </WindowFrame>
        </div>
      </div>
    </section>
  );
}
