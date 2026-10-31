import { Crown, Hourglass, Infinity as InfinityIcon, Repeat, Tag, Undo2 } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { money, pct } from "./format";
import { SectionHeading } from "./section-heading";

const PRICE = 4900;
const RATE = 0.3;
const MONTHS = 12;

/** Commission models with real numbers, and a worked example of a recurring commission. */
export function Commissions({ t, locale, currency, holdDays }: { t: Translator; locale: string; currency: string; holdDays: number }) {
  const m = (cents: number) => money(cents, currency, locale);
  const cards = [
    { icon: Repeat, value: pct(0.3, locale), title: t("home.comm.c1Title"), text: t("home.comm.c1Text"), featured: true },
    { icon: Tag, value: m(2000), title: t("home.comm.c2Title"), text: t("home.comm.c2Text") },
    { icon: InfinityIcon, value: pct(0.2, locale), title: t("home.comm.c3Title"), text: t("home.comm.c3Text") },
    { icon: Crown, value: pct(0.4, locale), title: t("home.comm.c4Title"), text: t("home.comm.c4Text") },
  ];
  const perMonth = Math.round(PRICE * RATE);
  const months = Array.from({ length: MONTHS }, (_, i) => perMonth * (i + 1));
  const total = months[MONTHS - 1];

  return (
    <section id="commissions" aria-labelledby="commissions-title" className="scroll-mt-16 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="commissions-title" eyebrow={t("home.comm.eyebrow")} title={t("home.comm.title")} text={t("home.comm.text")} />

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <li
                key={c.title}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-6",
                  c.featured ? "border-primary bg-primary-soft shadow-[0_24px_48px_-32px_var(--primary)]" : "border-line bg-surface",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <bdi className="font-display text-4xl font-bold tracking-tight tabular-nums">{c.value}</bdi>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", c.featured ? "bg-primary text-white" : "bg-primary-soft text-primary-text")}>
                    <c.icon className="size-4.5" aria-hidden />
                  </span>
                </span>
                <h3 className="mt-4 text-[17px] font-bold">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{c.text}</p>
              </li>
            ))}
          </ul>

          <figure className="relative flex flex-col overflow-hidden rounded-2xl bg-[#1d0b16] p-6 ring-1 ring-white/10 text-white shadow-[0_40px_80px_-40px_rgba(131,24,67,0.7)] sm:p-8">
            <div aria-hidden className="absolute -end-24 -top-24 size-72 rounded-full bg-primary/50 blur-[90px]" />
            <div aria-hidden className="absolute -start-20 bottom-0 size-56 rounded-full bg-amber-400/15 blur-[90px]" />
            <figcaption className="relative">
              <span className="text-lg font-bold">{t("home.comm.exTitle", { price: m(PRICE) })}</span>
              <span className="mt-1 block text-sm text-white/65">
                {t("home.comm.exRate", { rate: pct(RATE, locale) })} · {t("home.comm.exPerMonth", { amount: m(perMonth) })}
              </span>
            </figcaption>

            <div className="relative mt-8 flex items-end justify-between gap-6">
              <span>
                <span className="block text-xs font-semibold tracking-wide text-pink-200/80 uppercase tall-script:normal-case">{t("home.comm.exTotal")}</span>
                <bdi className="mt-1 block font-display text-5xl font-bold tracking-tight tabular-nums">{m(total)}</bdi>
              </span>
            </div>

            <div role="img" aria-label={t("home.comm.exChart")} className="relative mt-6 flex h-36 items-end gap-1.5 sm:gap-2">
              {months.map((v, i) => (
                <span key={i} className="flex h-full flex-1 flex-col justify-end gap-1.5">
                  <span
                    className={cn(
                      "block rounded-t-md",
                      i === MONTHS - 1 ? "bg-gradient-to-t from-pink-500 to-pink-300" : "bg-gradient-to-t from-primary/70 to-pink-400/70",
                    )}
                    style={{ height: `${(v / total) * 100}%` }}
                  />
                </span>
              ))}
            </div>
            <div aria-hidden className="relative mt-2 flex justify-between text-[10px] text-white/50">
              <span>{t("home.comm.exMonth", { n: 1 })}</span>
              <span>{t("home.comm.exMonth", { n: MONTHS })}</span>
            </div>

            <ul className="relative mt-7 space-y-2.5 border-t border-white/10 pt-6 text-sm text-white/80">
              <li className="flex items-start gap-2.5">
                <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                {t("home.comm.exHold", { days: holdDays })}
              </li>
              <li className="flex items-start gap-2.5">
                <Undo2 className="mt-0.5 size-4 shrink-0 text-pink-300" aria-hidden />
                {t("home.comm.exRefund")}
              </li>
            </ul>
          </figure>
        </div>
      </div>
    </section>
  );
}
