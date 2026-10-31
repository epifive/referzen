import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { Money, Num } from "@/components/dashboard/merchant-ui";
import { DashHeader } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { requireDashboardUser } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { getProgramCardStats } from "@/lib/merchant-stats";
import { atLimit, getEntitlements } from "@/lib/plans";
import { getUserPrograms } from "@/lib/programs";
import { describeRate } from "@/referral/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.overview") };
}

type Props = { searchParams: Promise<{ deleted?: string }> };

/** Account overview: the user's referral programs (each program has its own pages under /dashboard/programs/<id>). */
export default async function DashboardOverview({ searchParams }: Props) {
  const user = await requireDashboardUser();
  const [t, locale, programs, entitlements, query] = await Promise.all([getT(), getLocale(), getUserPrograms(user.id), getEntitlements(user), searchParams]);

  if (!programs.length) {
    return (
      <div className="mx-auto max-w-3xl py-4 sm:py-10">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <h1 className="text-3xl font-bold" dir="auto">
            {t("dash.onboarding.title", { name: user.name.split(" ")[0] || user.name })}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-muted">{t("dash.onboarding.text")}</p>
        </div>
        <ol className="mb-8 grid gap-3 sm:grid-cols-3">
          {(["dash.onboarding.step1", "dash.onboarding.step2", "dash.onboarding.step3"] as const).map((key, i) => (
            <li key={key} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
              <span className="pt-1">{t(key)}</span>
            </li>
          ))}
        </ol>
        <div className="text-center">
          <ButtonLink href="/dashboard/programs/new" size="lg">
            <Plus aria-hidden />
            {t("dash.home.createFirst")}
          </ButtonLink>
        </div>
      </div>
    );
  }

  const full = atLimit(programs.length, entitlements.maxPrograms);
  const stats = await Promise.all(programs.map((p) => getProgramCardStats(p.id)));

  return (
    <>
      <DashHeader
        title={t("dash.overview.title")}
        description={plural(t, "dash.overview.count", programs.length, { n: programs.length })}
        actions={
          full ? (
            <ButtonLink href="/pricing" variant="outline">
              {t("dash.programs.upgrade")}
            </ButtonLink>
          ) : (
            <ButtonLink href="/dashboard/programs/new">
              <Plus aria-hidden />
              {t("dash.programs.add")}
            </ButtonLink>
          )
        }
      />
      {query.deleted ? (
        <Alert tone="success" className="mb-5">
          {t("dash.programs.deleted")}
        </Alert>
      ) : null}
      <ul className="grid gap-4 lg:grid-cols-2">
        {programs.map((program, i) => {
          const s = stats[i];
          const status =
            program.status === "paused" ? (
              <Badge tone="neutral">{t("dash.programs.paused")}</Badge>
            ) : program.verifiedAt ? (
              <Badge tone="success">{t("dash.home.live")}</Badge>
            ) : (
              <Badge tone="warning">{t("dash.home.notInstalled")}</Badge>
            );
          const cells: Array<[string, React.ReactNode]> = [
            [t("dash.home.affiliates"), <Num key="a" value={s.affiliates} locale={locale.code} />],
            [t("dash.home.clicks30"), <Num key="c" value={s.clicks30} locale={locale.code} />],
            [t("dash.home.conversions30"), <Num key="v" value={s.conversions30} locale={locale.code} />],
            [t("dash.home.revenue30"), <Money key="r" cents={s.revenue30Cents} currency={program.currency} locale={locale.code} />],
            [t("dash.home.owed"), <Money key="o" cents={s.owedCents} currency={program.currency} locale={locale.code} />],
            [t("dash.home.paid"), <Money key="p" cents={s.paidCents} currency={program.currency} locale={locale.code} />],
          ];
          return (
            <li key={program.id} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-primary-line">
              <div className="flex items-start gap-3 p-5 pb-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-base font-bold text-primary uppercase" aria-hidden>
                  {program.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-sans text-base font-semibold tracking-normal">
                    <Link href={`/dashboard/programs/${program.id}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none" dir="auto">
                      {program.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span dir="ltr">{program.domain}</span>
                    <span aria-hidden>·</span>
                    <bdi>{describeRate(program.settings.commissionType, program.settings.rate, program.currency)}</bdi>
                  </p>
                </div>
                {status}
              </div>
              <dl className="grid grid-cols-3 gap-px border-t border-line bg-line">
                {cells.map(([label, value]) => (
                  <div key={label} className="bg-surface px-4 py-3">
                    <dt className="truncate text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
                    <dd className="mt-0.5 truncate text-base font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {s.pendingAffiliates > 0 ? (
                <Link
                  href={`/dashboard/programs/${program.id}/affiliates?status=pending`}
                  className="relative z-10 flex items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  {plural(t, "dash.home.pendingAffiliates", s.pendingAffiliates, { n: s.pendingAffiliates })}
                  <ArrowRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
