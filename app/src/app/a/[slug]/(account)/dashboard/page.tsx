import Link from "next/link";
import { Clock3 } from "lucide-react";
import { DailyBars, type BarPoint } from "@/components/portal/chart";
import { PortalCopyField } from "@/components/portal/copy";
import { EmptyNote, Kpi, PortalSection, PortalTable, PTd, PTh, StatusBadge } from "@/components/portal/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPortalConversions, getPortalOverview, PORTAL_RANGES, type PortalRange } from "@/lib/portal-data";
import { defaultLink, fmtDate, fmtMoney, fmtNumber, requireAffiliate } from "@/lib/portal-page";
import { listSeparator } from "@/lib/dash-format";
import { plural, type MessageKey } from "@/lib/i18n/messages";

export const metadata = { title: "Dashboard" };

const METRICS = ["clicks", "conversions", "earnings"] as const;
type Metric = (typeof METRICS)[number];

export default async function PortalDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; metric?: string; welcome?: string; password?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { program, affiliate, t, locale } = await requireAffiliate(slug);

  if (affiliate.status !== "approved") {
    return (
      <PortalSection>
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Clock3 className="size-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-bold">{t("portal.pending.title")}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">{t("portal.pending.text", { program: program.name, email: affiliate.email })}</p>
            <ButtonLink href={`/a/${slug}/settings`} variant="outline" className="mt-4">
              {t("portal.pending.settings")}
            </ButtonLink>
          </div>
        </div>
      </PortalSection>
    );
  }

  const range: PortalRange = PORTAL_RANGES.includes(Number(query.range) as PortalRange) ? (Number(query.range) as PortalRange) : 30;
  const metric: Metric = METRICS.includes(query.metric as Metric) ? (query.metric as Metric) : "clicks";
  const [overview, recent] = await Promise.all([getPortalOverview(program, affiliate.id, range), getPortalConversions(program.id, affiliate.id, { limit: 5 })]);
  const money = (cents: number) => fmtMoney(cents, program.currency, locale);
  const num = (n: number) => fmtNumber(n, locale);
  const link = defaultLink(program, affiliate.code);

  const valueOf = (d: (typeof overview.days)[number]) => (metric === "clicks" ? d.clicks : metric === "conversions" ? d.conversions : d.commissionCents);
  const fmtValue = (v: number) => (metric === "earnings" ? money(v) : num(v));
  const points: BarPoint[] = overview.days.map((d) => ({
    day: d.day,
    value: valueOf(d),
    tip: {
      title: fmtDate(d.day, locale),
      lines: [
        plural(t, "portal.kpi.clicksLine", d.clicks, { n: num(d.clicks), unique: num(d.uniqueClicks) }),
        plural(t, "portal.kpi.conversionsLine", d.conversions, { n: num(d.conversions) }),
        t("portal.kpi.earningsLine", { amount: money(d.commissionCents) }),
      ],
    },
  }));
  const max = Math.max(0, ...points.map((p) => p.value));
  const half = Math.round(max / 2);
  const href = (r: number, m: Metric) => `/a/${slug}/dashboard?${new URLSearchParams({ range: String(r), metric: m })}`;
  // Reversals after a payout can outweigh the approved balance; the rest carries over to
  // future commissions, so the next payout never shows a negative amount.
  const dueCents = Math.max(0, overview.dueCents);
  const outstandingCents = Math.max(0, -overview.dueCents);
  const remaining = Math.max(0, overview.minPayoutCents - dueCents);
  const progress = overview.minPayoutCents > 0 ? Math.min(100, Math.round((dueCents / overview.minPayoutCents) * 100)) : dueCents > 0 ? 100 : 0;
  const rate = overview.conversionRate;

  return (
    <div className="space-y-6">
      {query.welcome ? <Alert tone="success" title={t("portal.welcome.title")}>{t("portal.welcome.text")}</Alert> : null}
      {query.password ? <Alert tone="success">{t("portal.password.set")}</Alert> : null}

      <PortalSection title={t("portal.link.title")} description={t("portal.link.text")}>
        <PortalCopyField id="referral-link" value={link} label={t("portal.link.title")} />
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted">{t("portal.link.code")}</dt>
            <dd className="rounded-md bg-paper px-2 py-0.5 font-mono font-medium" dir="ltr" id="referral-code">
              {affiliate.code}
            </dd>
          </div>
          {affiliate.couponCode ? (
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("portal.link.coupon")}</dt>
              <dd className="rounded-md bg-primary-soft px-2 py-0.5 font-mono font-medium text-primary-text" dir="ltr">
                {affiliate.couponCode}
              </dd>
            </div>
          ) : null}
          <div>
            <Link href={`/a/${slug}/links`} className="font-medium text-primary-text hover:underline">
              {t("portal.link.builder")}
            </Link>
          </div>
        </dl>
      </PortalSection>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t("portal.kpi.title", { days: range })}</h2>
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm" role="group" aria-label={t("portal.kpi.range")}>
            {PORTAL_RANGES.map((r) => (
              <Link
                key={r}
                href={href(r, metric)}
                aria-current={r === range ? "true" : undefined}
                className={cn("rounded-md px-3 py-1 font-medium", r === range ? "bg-primary text-white" : "text-muted hover:text-ink")}
              >
                {t("portal.kpi.days", { n: r })}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" id="portal-kpis">
          <Kpi label={t("portal.kpi.clicks")} value={<span data-kpi="clicks">{num(overview.clicks)}</span>} hint={<span data-kpi="unique">{t("portal.kpi.unique", { n: num(overview.uniqueClicks) })}</span>} />
          <Kpi label={t("portal.kpi.referrals")} value={<span data-kpi="referrals">{num(overview.referrals)}</span>} />
          <Kpi label={t("portal.kpi.conversions")} value={<span data-kpi="conversions">{num(overview.conversions)}</span>} />
          <Kpi
            label={t("portal.kpi.rate")}
            value={rate === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(rate)}
            hint={t("portal.kpi.rateHint")}
          />
          <Kpi label={t("portal.kpi.earned")} value={<span data-kpi="earned">{money(overview.rangeCommissionCents)}</span>} emphasis />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <PortalSection
          title={t("portal.chart.title")}
          actions={
            <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="group" aria-label={t("portal.chart.metric")}>
              {METRICS.map((m) => (
                <Link
                  key={m}
                  href={href(range, m)}
                  aria-current={m === metric ? "true" : undefined}
                  className={cn("rounded-md px-2.5 py-1 font-medium", m === metric ? "bg-primary-soft text-primary-text" : "text-muted hover:text-ink")}
                >
                  {t(`portal.chart.${m}` as MessageKey)}
                </Link>
              ))}
            </div>
          }
        >
          <DailyBars
            data={points}
            label={t("portal.chart.label", { metric: t(`portal.chart.${metric}` as MessageKey), days: range })}
            formatValue={[fmtValue(max), fmtValue(half)]}
            ticks={[fmtDate(overview.fromDay, locale), fmtDate(overview.days[Math.floor(overview.days.length / 2)].day, locale), fmtDate(overview.toDay, locale)]}
            emptyText={t("portal.chart.empty")}
            separator={listSeparator(locale)}
          />
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">{t("portal.chart.table")}</summary>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <PortalTable minWidth={420}>
                <thead>
                  <tr>
                    <PTh>{t("portal.table.date")}</PTh>
                    <PTh className="text-end">{t("portal.kpi.clicks")}</PTh>
                    <PTh className="text-end">{t("portal.kpi.conversions")}</PTh>
                    <PTh className="text-end">{t("portal.table.commission")}</PTh>
                  </tr>
                </thead>
                <tbody>
                  {[...overview.days].reverse().map((d) => (
                    <tr key={d.day}>
                      <PTd>{fmtDate(d.day, locale)}</PTd>
                      <PTd className="text-end tabular-nums">{num(d.clicks)}</PTd>
                      <PTd className="text-end tabular-nums">{num(d.conversions)}</PTd>
                      <PTd className="text-end tabular-nums">{money(d.commissionCents)}</PTd>
                    </tr>
                  ))}
                </tbody>
              </PortalTable>
            </div>
          </details>
        </PortalSection>

        <PortalSection title={t("portal.balance.title")}>
          <dl className="divide-y divide-line text-sm" id="portal-balance">
            <div className="flex justify-between gap-4 py-2.5">
              <dt>
                <span className="block">{t("portal.balance.pending")}</span>
                <span className="text-xs text-muted">{t("portal.balance.pendingHint", { days: program.settings.holdDays })}</span>
              </dt>
              <dd className="font-medium tabular-nums" data-balance="pending">{money(overview.earnings.pendingCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt>{t("portal.balance.approved")}</dt>
              <dd className="font-medium tabular-nums" data-balance="approved">{money(overview.earnings.approvedCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt>{t("portal.balance.paid")}</dt>
              <dd className="font-medium tabular-nums" data-balance="paid">{money(overview.earnings.paidCents)}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-lg bg-paper p-4">
            <p className="text-xs font-medium text-muted">{t("portal.balance.next")}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums" data-balance="due">{money(dueCents)}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("portal.balance.next")}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            {outstandingCents > 0 ? (
              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400" data-balance="outstanding">
                {t("portal.balance.outstanding", { amount: money(outstandingCents) })}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                {overview.minPayoutCents > 0 && remaining > 0
                  ? t("portal.balance.toGo", { amount: money(remaining), minimum: money(overview.minPayoutCents) })
                  : t("portal.balance.ready")}
              </p>
            )}
            {overview.earnings.adjustmentCents < 0 && outstandingCents === 0 ? (
              <p className="mt-1 text-xs text-muted" data-balance="adjustment">
                {t("portal.balance.adjustment", { amount: money(-overview.earnings.adjustmentCents) })}
              </p>
            ) : null}
            {overview.processingCents > 0 ? <p className="mt-1 text-xs text-muted">{t("portal.balance.processing", { amount: money(overview.processingCents) })}</p> : null}
          </div>
        </PortalSection>
      </div>

      <PortalSection
        title={t("portal.recent.title")}
        padded={false}
        actions={
          <Link href={`/a/${slug}/earnings`} className="text-sm font-medium text-primary-text hover:underline">
            {t("portal.recent.all")}
          </Link>
        }
      >
        {recent.rows.length ? (
          <PortalTable mobileMinWidth={0}>
            <thead>
              <tr>
                <PTh>{t("portal.table.date")}</PTh>
                <PTh className="max-sm:hidden">{t("portal.table.customer")}</PTh>
                <PTh className="text-end max-sm:hidden">{t("portal.table.amount")}</PTh>
                <PTh className="text-end">{t("portal.table.commission")}</PTh>
                <PTh>{t("portal.table.status")}</PTh>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((c) => (
                <tr key={c.id}>
                  <PTd>
                    <span className="whitespace-nowrap">{fmtDate(c.occurredAt, locale)}</span>
                    <span dir="ltr" className="block text-start text-xs text-muted sm:hidden">
                      {c.customer || "—"}
                    </span>
                  </PTd>
                  <PTd className="text-muted max-sm:hidden">
                    <span dir="ltr">{c.customer || "—"}</span>
                    {c.nth > 1 ? <span className="ms-2 text-xs">{t("portal.table.renewal", { n: c.nth })}</span> : null}
                  </PTd>
                  <PTd className="text-end tabular-nums max-sm:hidden">{fmtMoney(c.amountCents, c.currency, locale)}</PTd>
                  <PTd className="text-end font-medium tabular-nums">{fmtMoney(c.commissionCents, program.currency, locale)}</PTd>
                  <PTd>
                    <StatusBadge status={c.status} label={t(`portal.status.${c.status}` as MessageKey)} />
                  </PTd>
                </tr>
              ))}
            </tbody>
          </PortalTable>
        ) : (
          <EmptyNote>{t("portal.recent.empty")}</EmptyNote>
        )}
      </PortalSection>
    </div>
  );
}
