import type { Metadata } from "next";
import Link from "next/link";
import { Check, Download, Receipt, ShieldAlert } from "lucide-react";
import { bulkApproveConversionsAction } from "@/app/actions/dashboard/conversions";
import { ConversionActions, ConversionFilters, ManualConversionForm, ReasonList } from "@/components/dashboard/conversion-forms";
import { BulkForm, SelectAll } from "@/components/dashboard/merchant-client";
import { AffiliateCell, ConversionStatusBadge, FlagBadges, Money, sourceLabel } from "@/components/dashboard/merchant-ui";
import { DashHeader, DTable, DTd, DTh, Empty, LinkTabs, Pager, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber, formatTime, intParam } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural, type MessageKey } from "@/lib/i18n/messages";
import { conversionFiltersFrom, filterQuery } from "@/lib/merchant-filters";
import { formatMoney } from "@/referral/normalize";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { affiliateOptions, countConversionsByStatus, listConversions } from "@/lib/merchant-stats";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.conversions") };
}

const PAGE_SIZE = 50;

export default async function ConversionsPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { program } = await requireProgram(id);
  const { filters, raw } = conversionFiltersFrom(query);
  const page = intParam(query.page as string | undefined, 1);
  const [t, locale, list, counts, affiliates, flaggedPending] = await Promise.all([
    getT(),
    getLocale(),
    listConversions(program.id, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countConversionsByStatus(program.id),
    affiliateOptions(program.id),
    listConversions(program.id, { status: "pending", flagged: true }, { limit: 1 }),
  ]);
  const lc = locale.code;
  const base = programPath(program.id, "conversions");
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const tab = (status?: string) => `${base}${filterQuery({ ...raw, status })}`;
  const hasPending = list.rows.some((r) => r.status === "pending");

  return (
    <>
      <ReasonList />
      <DashHeader
        title={t("dash.nav.conversions")}
        description={t("dash.conv.subtitle")}
        actions={
          <a href={`${programPath(program.id, "conversions/export")}${filterQuery(raw)}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:border-primary-line hover:text-primary" download>
            <Download className="size-4" aria-hidden />
            {t("dash.conv.export")}
          </a>
        }
      />

      <div className="mb-5 flex flex-wrap justify-end">
        <ManualConversionForm
          programId={program.id}
          currency={program.currency}
          affiliates={affiliates.filter((a) => a.status !== "blocked")}
          defaultAffiliateId={filters.affiliateId}
        />
      </div>

      {flaggedPending.total > 0 && !(raw.flagged && raw.status === "pending") ? (
        <Alert tone="warning" className="mb-5" title={plural(t, "dash.conv.reviewTitle", flaggedPending.total, { n: flaggedPending.total })}>
          {t("dash.conv.reviewText")}{" "}
          <Link href={`${base}?status=pending&flagged=1`} className="font-semibold underline underline-offset-2">
            {t("dash.conv.reviewLink")}
          </Link>
        </Alert>
      ) : null}

      <Panel padded={false}>
        <div className="space-y-4 border-b border-line px-4 py-4">
          <LinkTabs
            label={t("dash.conv.col.status")}
            items={[
              { href: tab(undefined), label: t("dash.aff.all"), active: !raw.status, count: counts.all },
              ...(["pending", "approved", "paid", "reversed"] as const).map((s) => ({ href: tab(s), label: t(`dash.conv.status.${s}` as MessageKey), active: raw.status === s, count: counts[s] })),
            ]}
          />
          <ConversionFilters base={base} current={raw} affiliates={affiliates} />
        </div>

        {counts.pending > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/50 px-4 py-2.5">
            <BulkForm id="conv-bulk" action={bulkApproveConversionsAction} fields={{ program_id: program.id }}>
              <span className="text-xs text-muted">{t("dash.conv.selectedPending")}</span>
              <Button type="submit" variant="outline" size="sm">
                <Check aria-hidden />
                {t("dash.conv.approveSelected")}
              </Button>
            </BulkForm>
          </div>
        ) : null}

        {list.rows.length ? (
          <DTable minWidth={840} label={t("dash.nav.conversions")}>
            <thead>
              <tr>
                <DTh className="w-10">{hasPending ? <SelectAll form="conv-bulk" label={t("dash.aff.selectAll")} /> : null}</DTh>
                <DTh>{t("dash.conv.col.date")}</DTh>
                <DTh>{t("dash.conv.col.affiliate")}</DTh>
                <DTh>{t("dash.conv.col.order")}</DTh>
                <DTh className="text-end">{t("dash.conv.col.commission")}</DTh>
                <DTh>{t("dash.conv.col.status")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.aff.col.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((c) => (
                <tr key={c.id} className={c.flags.length && c.status === "pending" ? "bg-red-50/40 dark:bg-red-950/10" : "hover:bg-paper/60"}>
                  <DTd>
                    {c.status === "pending" ? (
                      <input type="checkbox" name="conversion_ids" value={c.id} form="conv-bulk" aria-label={t("dash.conv.selectOne", { id: c.externalId })} className="size-4 rounded border-line accent-[var(--primary)]" />
                    ) : null}
                  </DTd>
                  <DTd className="whitespace-nowrap text-muted">
                    {formatDateTime(c.occurredAt, lc, false)}
                    <span className="block text-xs">{formatTime(c.occurredAt, lc)}</span>
                  </DTd>
                  <DTd>
                    <div className="max-w-44">
                      <AffiliateCell href={programPath(program.id, `affiliates/${c.affiliateId}`)} name={c.affiliateName} sub={c.affiliateCode} />
                    </div>
                  </DTd>
                  <DTd>
                    {/* Long ids (Stripe invoices, UUIDs) are cut to keep the actions column in view; the full id is in the title. */}
                    <p dir="ltr" className="max-w-36 truncate text-start font-mono text-[12px] 2xl:max-w-56" title={c.externalId}>
                      {c.externalId}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {sourceLabel(c.source, t)}
                      {c.nth > 1 ? <span className="rounded bg-primary-soft px-1 text-[11px] font-medium text-primary">{t("dash.conv.renewal", { n: c.nth })}</span> : null}
                    </p>
                    <FlagBadges flags={c.flags} t={t} className="mt-1" />
                  </DTd>
                  <DTd className="text-end whitespace-nowrap">
                    {/* Commission (program currency) with the sale amount (its own currency) below. */}
                    {c.flags.includes("currency_mismatch") && c.status === "pending" && c.commissionCents === 0 ? (
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t("dash.conv.commissionToSet")}</span>
                    ) : (
                      <Money cents={c.commissionCents} currency={program.currency} locale={lc} className={c.status === "reversed" ? "font-semibold text-muted line-through" : "font-semibold"} />
                    )}
                    <span className={c.status === "reversed" ? "block text-xs text-muted line-through" : "block text-xs text-muted"}>
                      {t("dash.conv.onAmount", { amount: formatMoney(c.amountCents, c.currency, lc) })}
                    </span>
                  </DTd>
                  <DTd>
                    <ConversionStatusBadge status={c.status} t={t} />
                    {c.status === "reversed" && c.reversalReason ? (
                      <p dir="auto" className="mt-1 max-w-28 truncate text-xs text-muted 2xl:max-w-48" title={c.reversalReason}>
                        {c.reversalReason}
                      </p>
                    ) : c.status === "paid" && c.paidAt ? (
                      <p className="mt-1 text-xs text-muted">{formatDateTime(c.paidAt, lc, false)}</p>
                    ) : null}
                  </DTd>
                  <DTd className="text-end">
                    <ConversionActions programId={program.id} currency={program.currency} conversion={c} />
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={counts.all ? <ShieldAlert /> : <Receipt />} title={counts.all ? t("dash.conv.noMatch") : t("dash.conv.emptyTitle")}>
            {counts.all ? (
              <Link href={base} className="font-medium text-primary hover:underline">
                {t("dash.aff.clearFilters")}
              </Link>
            ) : (
              <>
                {t("dash.conv.emptyText")}{" "}
                <Link href={programPath(program.id, "integrations")} className="font-medium text-primary hover:underline">
                  {t("dash.conv.emptyLink")}
                </Link>
              </>
            )}
          </Empty>
        )}
        <Pager
          page={page}
          pages={pages}
          href={(p) => `${base}${filterQuery({ ...raw, page: p > 1 ? p : undefined })}`}
          labels={{
            summary: t("dash.aff.pageSummary", { page, pages, total: formatNumber(list.total, lc) }),
            previous: t("dash.pager.previous"),
            next: t("dash.pager.next"),
            nav: t("dash.pager.label"),
          }}
        />
      </Panel>
    </>
  );
}
