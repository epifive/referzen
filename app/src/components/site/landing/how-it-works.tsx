import { FileSpreadsheet, UserPlus } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { Avatar } from "./hero-mockup";
import { EXAMPLE_AFFILIATES, money } from "./format";
import { SectionHeading } from "./section-heading";

/** Three steps from sign-up to the first paid commission, each with a small illustration. */
export function HowItWorks({ t, site, locale, currency, scriptUrl }: { t: Translator; site: string; locale: string; currency: string; scriptUrl: string }) {
  const steps = [
    {
      title: t("home.step1Title"),
      text: t("home.step1Text", { site }),
      visual: (
        <div dir="ltr" className="overflow-hidden rounded-xl border border-line bg-[#1a0d15] px-3.5 py-3 text-start font-mono text-[11px] leading-relaxed text-pink-100/90 shadow-inner">
          <p className="truncate">
            <span className="text-pink-400">&lt;script</span> <span className="text-amber-300">async</span>
          </p>
          <p className="truncate ps-4">
            <span className="text-amber-300">src</span>=<span className="text-emerald-300">&quot;{scriptUrl}&quot;</span>
          </p>
          <p className="truncate ps-4">
            <span className="text-amber-300">data-program</span>=<span className="text-emerald-300">&quot;pk_8f2c…&quot;</span>
            <span className="text-pink-400">&gt;&lt;/script&gt;</span>
          </p>
        </div>
      ),
    },
    {
      title: t("home.step2Title"),
      text: t("home.step2Text"),
      visual: (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-paper/70 px-3.5 py-3">
          <span className="flex -space-x-2 rtl:space-x-reverse">
            {EXAMPLE_AFFILIATES.map((a) => (
              <Avatar key={a.name} name={a.name} tone={a.tone} className="size-8 ring-2 ring-surface" />
            ))}
          </span>
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <UserPlus className="size-3.5" aria-hidden />
            {t("home.step2Badge")}
          </span>
        </div>
      ),
    },
    {
      title: t("home.step3Title"),
      text: t("home.step3Text"),
      visual: (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-paper/70 px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#107c41] text-white">
            <FileSpreadsheet className="size-4.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span dir="ltr" className="block truncate text-start font-mono text-xs font-semibold">
              paypal-payouts.csv
            </span>
            <span className="block truncate text-xs text-muted">{t("home.step3Badge", { n: 14, amount: money(482650, currency, locale) })}</span>
          </span>
        </div>
      ),
    },
  ];

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-b border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="how-title" align="center" eyebrow={t("home.howEyebrow")} title={t("home.howTitle")} text={t("home.howText")} />
        <ol className="relative mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* The dashed path that links the three steps on wide screens. */}
          <span aria-hidden className="absolute inset-x-[16%] top-14 hidden border-t-2 border-dashed border-primary-line md:block" />
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex flex-col rounded-2xl border border-line bg-paper p-6 sm:p-7">
              <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary font-display text-2xl font-bold text-white shadow-lg shadow-primary/30">
                <span className="sr-only">{t("home.howStep", { n: i + 1 })}</span>
                <span aria-hidden>{i + 1}</span>
              </span>
              <h3 className="mt-6 text-xl font-bold tall-script:leading-snug">{step.title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-muted">{step.text}</p>
              <div className="mt-6">{step.visual}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
