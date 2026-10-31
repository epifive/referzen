import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Receipt, Users } from "lucide-react";
import { AffiliateCell, CheckItem, ConversionStatusBadge, Delta, Kpi, KpiGrid, Money, Num, sourceLabel } from "@/components/dashboard/merchant-ui";
import { ProgramChart } from "@/components/dashboard/program-chart";
import { DashHeader, DTable, DTd, DTh, Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { getCommissionTotals, getDailySeries, getPeriodKpis, getSetupStatus, getTopAffiliates, listConversions, periodRange } from "@/lib/merchant-stats";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { getOwnedProgram, portalPath } from "@/lib/programs";
import { getCurrentUser } from "@/lib/auth/session";
import { describeRate } from "@/referral/normalize";
import { plural } from "@/lib/i18n/messages";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, user, t] = await Promise.all([params, getCurrentUser(), getT()]);
  const program = user ? await getOwnedProgram(Number(id), user.id) : undefined;
  return { title: program?.name ?? t("dash.nav.programOverview") };
}

const PERIODS = [7, 30, 90] as const;

export default async function ProgramOverviewPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { program } = await requireProgram(id);
  const days = PERIODS.find((p) => String(p) === query.period) ?? 30;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const [kpis, previous, series, totals, top, recent, setup] = await Promise.all([
    getPeriodKpis(program.id, periodRange(days)),
    getPeriodKpis(program.id, periodRange(days, 1)),
    getDailySeries(program.id, days),
    getCommissionTotals(program.id),
    getTopAffiliates(program.id, days, 6),
    listConversions(program.id, {}, { limit: 6 }),
    getSetupStatus(program),
  ]);
  const lc = locale.code;
  const base = programPath(program.id);
  const vs = t("dash.prog.vsPrevious", { n: days });
  const rateBase = kpis.uniqueClicks || kpis.clicks;
  const conversionRate = rateBase > 0 ? (kpis.conversions / rateBase) * 100 : null;
  const steps = [setup.scriptInstalled, setup.serverConnected, setup.hasAffiliate, setup.hasConversion];
  const done = steps.filter(Boolean).length;

  return (
    <>
      <DashHeader
        title={program.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span dir="ltr">{program.domain}</span>
            <span aria-hidden>·</span>
            <bdi>{describeRate(program.settings.commissionType, program.settings.rate, program.currency)}</bdi>
            {program.settings.recurring.mode !== "none" ? (
              <Badge tone="primary">
                {program.settings.recurring.mode === "lifetime" ? t("dash.prog.recurringLifetime") : plural(t, "dash.prog.recurringMonths", program.settings.recurring.months)}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <LinkTabs
              label={t("dash.prog.period")}
              items={PERIODS.map((p) => ({ href: `${base}?period=${p}`, label: t("dash.prog.days", { n: p }), active: p === days }))}
            />
            <a href={portalPath(program.slug)} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:border-primary-line hover:text-primary">
              <ExternalLink className="size-4" aria-hidden />
              {t("dash.prog.openPortal")}
            </a>
          </>
        }
      />

      {program.status === "paused" ? (
        <Alert tone="warning" title={t("dash.prog.pausedTitle")} className="mb-6">
          {t("dash.prog.pausedText")}{" "}
          <Link href={programPath(program.id, "settings#danger")} className="font-semibold underline underline-offset-2">
            {t("dash.prog.pausedLink")}
          </Link>
        </Alert>
      ) : null}

      {done < steps.length ? (
        <Panel
          className="mb-6"
          title={t("dash.prog.setupTitle")}
          description={t("dash.prog.setupProgress", { done, total: steps.length })}
          actions={
            <div className="h-2 w-32 overflow-hidden rounded-full bg-line/70" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={t("dash.prog.setupTitle")}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
            </div>
          }
        >
          <ul className="divide-y divide-line">
            <CheckItem
              done={setup.scriptInstalled}
              title={t("dash.prog.stepScript")}
              text={t("dash.prog.stepScriptText", { domain: program.domain })}
              action={<ButtonLink href={programPath(program.id, "integrations")} size="sm" variant="outline">{t("dash.prog.stepScriptCta")}</ButtonLink>}
            />
            <CheckItem
              done={setup.serverConnected}
              title={t("dash.prog.stepWebhook")}
              text={t("dash.prog.stepWebhookText")}
              action={<ButtonLink href={`${programPath(program.id, "integrations")}#connect`} size="sm" variant="outline">{t("dash.prog.stepWebhookCta")}</ButtonLink>}
            />
            <CheckItem
              done={setup.hasAffiliate}
              title={t("dash.prog.stepAffiliate")}
              text={t("dash.prog.stepAffiliateText")}
              action={<ButtonLink href={`${programPath(program.id, "affiliates")}#invite`} size="sm" variant="outline">{t("dash.prog.stepAffiliateCta")}</ButtonLink>}
            />
            <CheckItem done={setup.hasConversion} title={t("dash.prog.stepConversion")} text={t("dash.prog.stepConversionText")} />
          </ul>
        </Panel>
      ) : null}

      <KpiGrid className="mb-6 grid-cols-2 sm:grid-cols-4">
        <Kpi label={t("dash.prog.kpi.clicks")} value={<Num value={kpis.clicks} locale={lc} />} delta={<Delta current={kpis.clicks} previous={previous.clicks} label={vs} />} hint={plural(t, "dash.prog.kpi.unique", kpis.uniqueClicks, { n: formatNumber(kpis.uniqueClicks, lc) })} />
        <Kpi label={t("dash.prog.kpi.referrals")} value={<Num value={kpis.referrals} locale={lc} />} delta={<Delta current={kpis.referrals} previous={previous.referrals} label={vs} />} hint={t("dash.prog.kpi.referralsHint")} />
        <Kpi label={t("dash.prog.kpi.conversions")} value={<Num value={kpis.conversions} locale={lc} />} delta={<Delta current={kpis.conversions} previous={previous.conversions} label={vs} />} hint={kpis.reversed ? t("dash.prog.kpi.reversed", { n: kpis.reversed }) : t("dash.prog.kpi.conversionsHint")} />
        <Kpi
          label={t("dash.prog.kpi.rate")}
          value={conversionRate === null ? "—" : <bdi>{formatNumber(conversionRate, lc, { maximumFractionDigits: conversionRate < 10 ? 2 : 1 })}%</bdi>}
          hint={t("dash.prog.kpi.rateHint")}
        />
        <Kpi label={t("dash.prog.kpi.revenue")} value={<Money cents={kpis.revenueCents} currency={program.currency} locale={lc} />} delta={<Delta current={kpis.revenueCents} previous={previous.revenueCents} label={vs} />} hint={
            <>
              {t("dash.prog.kpi.commissionPeriod")} <Money cents={kpis.commissionCents} currency={program.currency} locale={lc} />
            </>
          }
        />
        <Kpi accent="bg-amber-500" label={t("dash.prog.kpi.pending")} value={<Money cents={totals.pendingCents} currency={program.currency} locale={lc} />} hint={t("dash.prog.kpi.pendingHint", { n: program.settings.holdDays })} />
        <Kpi accent="bg-sky-500" label={t("dash.prog.kpi.approved")} value={<Money cents={totals.approvedCents} currency={program.currency} locale={lc} />} hint={<Link href={programPath(program.id, "payouts")} className="hover:text-primary hover:underline">{t("dash.prog.kpi.approvedHint")}</Link>} />
        <Kpi accent="bg-emerald-500" label={t("dash.prog.kpi.paid")} value={<Money cents={totals.paidCents} currency={program.currency} locale={lc} />} hint={t("dash.prog.kpi.paidHint")} />
      </KpiGrid>

      <Panel className="mb-6" title={t("dash.prog.chartTitle")} description={t("dash.prog.chartText", { n: days })}>
        <ProgramChart data={series} currency={program.currency} locale={lc} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={t("dash.prog.topTitle")}
          description={t("dash.prog.topText", { n: days })}
          padded={false}
          actions={
            <Link href={programPath(program.id, "affiliates")} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t("dash.prog.viewAll")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          }
        >
          {top.length ? (
            <DTable minWidth={420} label={t("dash.prog.topTitle")}>
              <thead>
                <tr>
                  <DTh>{t("dash.aff.col.affiliate")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.clicks")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.conversions")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.revenue")}</DTh>
                </tr>
              </thead>
              <tbody>
                {top.map((a) => (
                  <tr key={a.affiliateId} className="hover:bg-paper/60">
                    <DTd>
                      <AffiliateCell href={programPath(program.id, `affiliates/${a.affiliateId}`)} name={a.name} sub={a.code} />
                    </DTd>
                    <DTd className="text-end">
                      <Num value={a.clicks} locale={lc} />
                    </DTd>
                    <DTd className="text-end">
                      <Num value={a.conversions} locale={lc} />
                    </DTd>
                    <DTd className="text-end font-medium">
                      <Money cents={a.revenueCents} currency={program.currency} locale={lc} />
                    </DTd>
                  </tr>
                ))}
              </tbody>
            </DTable>
          ) : (
            <Empty icon={<Users />} title={t("dash.prog.topEmpty")}>
              {t("dash.prog.topEmptyText")}
            </Empty>
          )}
        </Panel>

        <Panel
          title={t("dash.prog.recentTitle")}
          padded={false}
          actions={
            <Link href={programPath(program.id, "conversions")} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t("dash.prog.viewAll")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          }
        >
          {recent.rows.length ? (
            <ul className="divide-y divide-line">
              {recent.rows.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Money cents={c.amountCents} currency={c.currency} locale={lc} className="font-semibold" />
                      <span className="text-muted">{t("dash.prog.via")}</span>
                      <Link href={programPath(program.id, `affiliates/${c.affiliateId}`)} dir="auto" className="truncate font-medium hover:text-primary">
                        {c.affiliateName}
                      </Link>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {sourceLabel(c.source, t)} · {formatDateTime(c.occurredAt, lc)} · {t("dash.conv.col.commission")}{" "}
                      <Money cents={c.commissionCents} currency={c.currency} locale={lc} />
                    </p>
                  </div>
                  <ConversionStatusBadge status={c.status} t={t} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<Receipt />} title={t("dash.prog.recentEmpty")}>
              {t("dash.prog.recentEmptyText")}
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
