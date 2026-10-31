import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, Landmark } from "lucide-react";
import { RefreshOnce } from "@/components/dashboard/actions";
import { Kpi, KpiGrid, maskedDetails, methodLabel, Money, Num, Step } from "@/components/dashboard/merchant-ui";
import { MarkBatchPaidForm, PayoutRowActions } from "@/components/dashboard/payout-forms";
import { DashHeader, DTable, DTd, DTh, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { type MessageKey, plural } from "@/lib/i18n/messages";
import { canSendMail } from "@/lib/merchant-mail";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { getPayoutMeta } from "@/lib/merchant-stats";
import { getBatchCsvRows, getOwnedBatch } from "@/lib/payouts";
import { formatMoney } from "@/referral/normalize";

type Props = { params: Promise<{ id: string; batchId: string }>; searchParams: Promise<{ created?: string; paid?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ batchId }, t] = await Promise.all([params, getT()]);
  return { title: t("dash.pay.batchName", { n: Number(batchId) || 0 }) };
}

export default async function BatchPage({ params, searchParams }: Props) {
  const [{ id, batchId }, query] = await Promise.all([params, searchParams]);
  const { program } = await requireProgram(id);
  const batch = await getOwnedBatch(program.id, Number(batchId));
  if (!batch) notFound();
  const [t, locale, rows, mail] = await Promise.all([getT(), getLocale(), getBatchCsvRows(batch.id, { includeCancelled: true }), canSendMail()]);
  const byId = await getPayoutMeta(program.id, rows.map((r) => r.payoutId));
  const lc = locale.code;
  const live = rows.filter((r) => r.status !== "cancelled");
  const paidCount = live.filter((r) => r.status === "paid").length;
  const paypal = live.filter((r) => r.method === "paypal" && r.details.paypalEmail && r.amountCents > 0);
  const paypalSkipped = live.length - paypal.length;
  const bank = live.filter((r) => r.method === "bank");
  const csvBase = programPath(program.id, `payouts/${batch.id}/csv`);
  const base = programPath(program.id, `payouts/${batch.id}`);

  const download = (format: string, label: string, count: number, hint: string, Icon: typeof Download) => (
    <a
      href={`${csvBase}?format=${format}`}
      download
      aria-disabled={count === 0}
      className={`flex items-start gap-3 rounded-lg border border-line p-3 transition-colors ${count === 0 ? "pointer-events-none opacity-50" : "hover:border-primary-line hover:bg-primary-soft/30"}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </a>
  );

  return (
    <>
      {query.created || query.paid ? <RefreshOnce cleanUrl={base} /> : null}
      <Link href={programPath(program.id, "payouts")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.pay.back")}
      </Link>
      <DashHeader
        title={t("dash.pay.batchName", { n: batch.id })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={batch.status === "paid" ? "success" : "warning"}>{batch.status === "paid" ? t("dash.pay.status.paid") : t("dash.pay.status.draft")}</Badge>
            <span>{t("dash.pay.createdOn", { date: formatDateTime(batch.createdAt, lc) })}</span>
            {batch.note ? <span dir="auto">· {batch.note}</span> : null}
          </span>
        }
      />
      {query.paid ? (
        <Alert tone="success" className="mb-6">
          {plural(t, "dash.pay.batchPaidDone", Number(query.paid) || 0)}
        </Alert>
      ) : null}
      {query.created ? (
        <Alert tone="success" className="mb-6" title={t("dash.pay.createdTitle")}>
          {t("dash.pay.createdText")}
        </Alert>
      ) : null}

      <KpiGrid className="mb-6 grid-cols-1 sm:grid-cols-3">
        <Kpi label={t("dash.pay.kpi.total")} value={<Money cents={batch.totalCents} currency={batch.currency} locale={lc} />} />
        <Kpi label={t("dash.pay.col.payouts")} value={<Num value={live.length} locale={lc} />} />
        <Kpi label={t("dash.pay.kpi.paidOf")} value={<bdi>{t("dash.pay.kpi.paidOfValue", { paid: paidCount, total: live.length })}</bdi>} />
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={t("dash.pay.payoutsTitle")} padded={false} className="min-w-0 self-start">
          <DTable minWidth={680} dense label={t("dash.pay.payoutsTitle")}>
            <thead>
              <tr>
                <DTh>{t("dash.aff.col.affiliate")}</DTh>
                <DTh>{t("dash.pay.col.method")}</DTh>
                <DTh className="text-end">{t("dash.pay.col.conversions")}</DTh>
                <DTh className="text-end">{t("dash.pay.col.amount")}</DTh>
                <DTh>{t("dash.pay.col.status")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.aff.col.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = byId.get(r.payoutId);
                const masked = maskedDetails(r.method as "paypal", r.details);
                return (
                  <tr key={r.payoutId} className={r.status === "cancelled" ? "opacity-50" : undefined}>
                    <DTd className="max-w-44">
                      {meta ? (
                        <Link href={programPath(program.id, `affiliates/${meta.affiliate_id}`)} dir="auto" className="block truncate font-medium hover:text-primary">
                          {r.affiliateName}
                        </Link>
                      ) : (
                        <span dir="auto">{r.affiliateName}</span>
                      )}
                      <p dir="ltr" className="truncate text-start text-xs text-muted">
                        {r.affiliateEmail}
                      </p>
                    </DTd>
                    <DTd className="max-w-40">
                      <p className="font-medium">{methodLabel(r.method as "paypal", t)}</p>
                      <p dir="ltr" title={masked || undefined} className={`truncate text-start text-xs ${masked ? "text-muted" : "text-amber-700 dark:text-amber-400"}`}>
                        {masked || t("dash.pay.missingDetails")}
                      </p>
                    </DTd>
                    <DTd className="text-end">
                      <Num value={r.conversionCount} locale={lc} />
                    </DTd>
                    <DTd className="text-end font-semibold">
                      <Money cents={r.amountCents} currency={r.currency} locale={lc} />
                      {r.adjustmentCents ? (
                        <p className="text-[11px] font-normal text-muted">
                          {t("dash.pay.adjustmentIncl", { amount: formatMoney(r.adjustmentCents, r.currency, lc) })}
                        </p>
                      ) : null}
                    </DTd>
                    <DTd>
                      <Badge tone={r.status === "paid" ? "success" : r.status === "draft" ? "warning" : "neutral"}>{t(`dash.pay.status.${r.status}` as MessageKey)}</Badge>
                      {r.status === "paid" ? (
                        <p className="mt-1 text-xs text-muted">
                          {meta?.paid_at ? formatDateTime(meta.paid_at, lc, false) : ""}
                          {r.reference ? (
                            <>
                              {" · "}
                              <bdi dir="ltr">{r.reference}</bdi>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </DTd>
                    <DTd className="text-end">{r.status === "draft" ? <PayoutRowActions programId={program.id} payoutId={r.payoutId} name={r.affiliateName} /> : null}</DTd>
                  </tr>
                );
              })}
            </tbody>
          </DTable>
        </Panel>

        <aside className="space-y-6">
          <Panel title={t("dash.pay.downloads")} description={t("dash.pay.downloadsText")}>
            <div className="space-y-2">
              {download("paypal", t("dash.pay.csvPaypal"), paypal.length, plural(t, "dash.pay.csvPaypalHint", paypal.length), Download)}
              {download("bank", t("dash.pay.csvBank"), bank.length, plural(t, "dash.pay.csvBankHint", bank.length), Landmark)}
              {download("generic", t("dash.pay.csvGeneric"), rows.length, t("dash.pay.csvGenericHint"), FileSpreadsheet)}
            </div>
            {paypal.length && paypalSkipped ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{plural(t, "dash.pay.paypalSkipped", paypalSkipped)}</p> : null}
          </Panel>

          {batch.status === "draft" && live.some((r) => r.status === "draft") ? (
            <Panel title={t("dash.pay.markTitle")}>
              <MarkBatchPaidForm programId={program.id} batchId={batch.id} notifyDefault={program.settings.emailAffiliates} canMail={mail} />
            </Panel>
          ) : null}

          <Panel title={t("dash.pay.howTitle")}>
            <ol>
              <Step n={1} title={t("dash.pay.how1")}>
                <p>{t("dash.pay.how1Text")}</p>
              </Step>
              <Step n={2} title={t("dash.pay.how2")}>
                <p>{t("dash.pay.how2Text")}</p>
              </Step>
              <Step n={3} title={t("dash.pay.how3")}>
                <p>{t("dash.pay.how3Text")}</p>
              </Step>
            </ol>
          </Panel>
        </aside>
      </div>
    </>
  );
}
