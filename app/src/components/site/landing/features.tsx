import { BellRing, Building2, Feather, Hourglass, Images, Languages, LayoutDashboard, Link2, Plug, Repeat, ShieldAlert, Wallet } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

const FEATURES: Array<{ icon: typeof Link2; key: string; accent?: string }> = [
  { icon: Link2, key: "links" },
  { icon: Feather, key: "tracking" },
  { icon: Repeat, key: "recurring", accent: "bg-[#635bff]/12 text-[#635bff] dark:text-[#a5a0ff]" },
  { icon: Plug, key: "integrations" },
  { icon: LayoutDashboard, key: "portal" },
  { icon: ShieldAlert, key: "fraud", accent: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  { icon: Hourglass, key: "hold" },
  { icon: Wallet, key: "payouts", accent: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  { icon: Images, key: "assets" },
  { icon: BellRing, key: "notify" },
  { icon: Languages, key: "lang" },
  { icon: Building2, key: "saas" },
];

export function Features({ t }: { t: Translator }) {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-16 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="features-title" eyebrow={t("home.featuresEyebrow")} title={t("home.featuresTitle")} text={t("home.featuresText")} />
        <ul className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.key} className="group relative bg-surface p-6 transition-colors hover:bg-paper/60 sm:p-7">
              <span
                className={cn(
                  "grid size-11 place-items-center rounded-xl ring-1 ring-current/10 transition-transform ring-inset group-hover:-translate-y-0.5 motion-reduce:group-hover:translate-y-0",
                  f.accent ?? "bg-primary-soft text-primary-text",
                )}
              >
                <f.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-[17px] font-bold">{t(`home.f.${f.key}Title` as MessageKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`home.f.${f.key}Text` as MessageKey)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
