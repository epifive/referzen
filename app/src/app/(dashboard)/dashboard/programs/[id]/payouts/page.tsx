import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HandCoins, History } from "lucide-react";
import { RefreshOnce } from "@/components/dashboard/actions";
import { maskedDetails, methodLabel, Money, Kpi, KpiGrid, Num } from "@/components/dashboard/merchant-ui";
import { CreateBatchForm, type DueRow } from "@/components/dashboard/payout-forms";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatList, formatNumber } from "@/lib/dash-format";
import { plural } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { getCommissionTotals } from "@/lib/merchant-stats";
import { getDueBalances, getProgramBatches } from "@/lib/payouts";
import { formatMoney } from "@/referral/normalize";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ cancelled?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.payouts") };
}

export default async function PayoutsPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { program } = await requireProgram(id);
  const [t, locale, due, batches, totals] = await Promise.all([getT(), getLocale(), getDueBalances(program), getProgramBatches(program.id, 100), getCommissionTotals(program.id)]);
  const lc = locale.code;
  const s = program.settings;
  const payable = due.filter((d) => d.meetsMinimum);
  const dueNow = payable.reduce((sum, d) => sum + d.amountCents, 0);
  const below = due.filter((d) => !d.meetsMinimum).reduce((sum, d) => sum + Math.max(0, d.amountCents), 0);
  const adjustments = due.reduce((sum, d) => sum + d.adjustmentCents, 0);
  const drafts = batches.filter((b) => b.status === "draft");
  const rows: DueRow[] = due.map((d) => ({
    affiliateId: d.affiliateId,
    name: d.name,
    email: d.email,
    method: d.method,
    details: maskedDetails(d.method, d.details),
    amountCents: d.amountCents,
    adjustmentCents: d.adjustmentCents,
    conversionCount: d.conversionCount,
    meetsMinimum: d.meetsMinimum,
    hasPayoutDetails: d.hasPayoutDetails,
  }));
  const base = programPath(program.id, "payouts");

  return (
    <>
      {query.cancelled ? <RefreshOnce cleanUrl={base} /> : null}
      <DashHeader
        title={t("dash.nav.payouts")}
        description={t("dash.pay.subtitle", {
          min: formatMoney(s.minPayoutCents, program.currency, lc),
          days: s.holdDays,
          methods: formatList(s.payoutMethods.map((m) => methodLabel(m, t)), lc),
        })}
      />
      {query.cancelled ? (
        <Alert tone="success" className="mb-5">
          {t("dash.pay.batchRemoved")}
        </Alert>
      ) : null}

      <KpiGrid className="mb-6 grid-cols-2 lg:grid-cols-4">
        <Kpi accent="bg-primary" label={t("dash.pay.kpi.dueNow")} value={<Money cents={dueNow} currency={program.currency} locale={lc} />} hint={plural(t, "dash.pay.kpi.dueNowHint", payable.length, { n: formatNumber(payable.length, lc) })} />
        <Kpi
          accent="bg-sky-500"
          label={t("dash.pay.kpi.waiting")}
          value={<Money cents={below} currency={program.currency} locale={lc} />}
          hint={adjustments < 0 ? t("dash.pay.kpi.adjustmentsHint", { amount: formatMoney(-adjustments, program.currency, lc) }) : t("dash.pay.kpi.waitingHint", { min: formatMoney(s.minPayoutCents, program.currency, lc) })}
        />
        <Kpi accent="bg-amber-500" label={t("dash.prog.kpi.pending")} value={<Money cents={totals.pendingCents} currency={program.currency} locale={lc} />} hint={t("dash.prog.kpi.pendingHint", { n: s.holdDays })} />
        <Kpi accent="bg-emerald-500" label={t("dash.prog.kpi.paid")} value={<Money cents={totals.paidCents} currency={program.currency} locale={lc} />} hint={t("dash.aff.allTime")} />
      </KpiGrid>

      {drafts.length ? (
        <Alert tone="info" className="mb-6" title={t("dash.pay.draftsTitle")}>
          <ul className="mt-1 space-y-1">
            {drafts.map((b) => (
              <li key={b.id}>
                <Link href={programPath(program.id, `payouts/${b.id}`)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  {t("dash.pay.batchName", { n: b.id })} · <Money cents={b.totalCents} currency={b.currency} locale={lc} /> · {plural(t, "dash.pay.payoutsCount", b.payoutCount, { n: formatNumber(b.payoutCount, lc) })}
                  <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Panel className="mb-6" title={t("dash.pay.dueTitle")} description={t("dash.pay.dueText")} padded={false}>
        {rows.length ? (
          <CreateBatchForm programId={program.id} currency={program.currency} locale={lc} rows={rows} minPayoutCents={s.minPayoutCents} />
        ) : (
          <Empty icon={<HandCoins />} title={t("dash.pay.dueEmpty")}>
            {t("dash.pay.dueEmptyText", { days: s.holdDays })}
          </Empty>
        )}
      </Panel>

      <Panel title={t("dash.pay.historyTitle")} padded={false}>
        {batches.length ? (
          <DTable minWidth={640} label={t("dash.pay.historyTitle")}>
            <thead>
              <tr>
                <DTh>{t("dash.pay.col.batch")}</DTh>
                <DTh>{t("dash.pay.col.created")}</DTh>
                <DTh className="text-end">{t("dash.pay.col.payouts")}</DTh>
                <DTh className="text-end">{t("dash.pay.col.amount")}</DTh>
                <DTh>{t("dash.pay.col.status")}</DTh>
                <DTh>{t("dash.pay.col.paidAt")}</DTh>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-paper/60">
                  <DTd>
                    <Link href={programPath(program.id, `payouts/${b.id}`)} className="font-medium text-primary hover:underline">
                      {t("dash.pay.batchName", { n: b.id })}
                    </Link>
                    {b.note ? (
                      <p dir="auto" className="max-w-56 truncate text-xs text-muted">
                        {b.note}
                      </p>
                    ) : null}
                  </DTd>
                  <DTd className="whitespace-nowrap text-muted">{formatDateTime(b.createdAt, lc, false)}</DTd>
                  <DTd className="text-end">
                    <Num value={b.payoutCount} locale={lc} />
                  </DTd>
                  <DTd className="text-end font-semibold">
                    <Money cents={b.totalCents} currency={b.currency} locale={lc} />
                  </DTd>
                  <DTd>
                    <Badge tone={b.status === "paid" ? "success" : "warning"}>{b.status === "paid" ? t("dash.pay.status.paid") : t("dash.pay.status.draft")}</Badge>
                  </DTd>
                  <DTd className="whitespace-nowrap text-muted">{b.paidAt ? formatDateTime(b.paidAt, lc, false) : "—"}</DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<History />} title={t("dash.pay.historyEmpty")}>
            {t("dash.pay.historyEmptyText")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
