import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyNote, Kpi, PortalSection, PortalTable, PTd, PTh, StatusBadge } from "@/components/portal/ui";
import { getAffiliateAdjustments, getAffiliateEarnings } from "@/lib/payouts";
import { getPortalConversions, getPortalPayouts } from "@/lib/portal-data";
import { fmtDate, fmtMoney, fmtNumber, requireAffiliate } from "@/lib/portal-page";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { isConversionStatus } from "@/referral/normalize";
import { CONVERSION_STATUSES, type ConversionStatus } from "@/referral/types";

export const metadata = { title: "Earnings" };

const PER_PAGE = 25;

export default async function PortalEarnings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { program, affiliate, t, locale } = await requireAffiliate(slug);
  if (affiliate.status !== "approved") redirect(`/a/${slug}/dashboard`);
  const status: ConversionStatus | undefined = isConversionStatus(query.status) ? query.status : undefined;
  const page = Math.max(1, Math.min(1000, Math.floor(Number(query.page)) || 1));
  const [earnings, conversions, payouts, adjustments] = await Promise.all([
    getAffiliateEarnings(program.id, affiliate.id),
    getPortalConversions(program.id, affiliate.id, { status, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    getPortalPayouts(program.id, affiliate.id),
    getAffiliateAdjustments(program.id, affiliate.id, 20),
  ]);
  const money = (cents: number) => fmtMoney(cents, program.currency, locale);
  const pages = Math.max(1, Math.ceil(conversions.total / PER_PAGE));
  const href = (s: ConversionStatus | undefined, p = 1) => `/a/${slug}/earnings?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("portal.balance.pending")} value={money(earnings.pendingCents)} hint={t("portal.balance.pendingHint", { days: program.settings.holdDays })} />
        <Kpi label={t("portal.balance.approved")} value={money(earnings.approvedCents)} emphasis />
        <Kpi label={t("portal.balance.paid")} value={money(earnings.paidCents)} />
        <Kpi label={t("portal.balance.reversed")} value={money(earnings.reversedCents)} hint={t("portal.balance.reversedHint")} />
      </div>

      <PortalSection title={t("portal.earnings.conversions")} padded={false}>
        <nav aria-label={t("portal.table.status")} className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3 text-sm">
          {[undefined, ...CONVERSION_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href(s)}
              aria-current={s === status ? "true" : undefined}
              className={cn("rounded-full px-3 py-1 font-medium", s === status ? "bg-primary text-white" : "bg-paper text-muted hover:text-ink")}
            >
              {s ? t(`portal.status.${s}` as MessageKey) : t("portal.earnings.all")}
            </Link>
          ))}
        </nav>
        {conversions.rows.length ? (
          <>
            <PortalTable minWidth={640} mobileMinWidth={0}>
              <thead>
                <tr>
                  <PTh>{t("portal.table.date")}</PTh>
                  <PTh className="max-sm:hidden">{t("portal.table.customer")}</PTh>
                  <PTh className="text-end max-sm:hidden">{t("portal.table.amount")}</PTh>
                  <PTh className="text-end">{t("portal.table.commission")}</PTh>
                  <PTh>{t("portal.table.status")}</PTh>
                </tr>
              </thead>
              <tbody id="portal-conversions">
                {conversions.rows.map((c) => (
                  <tr key={c.id}>
                    <PTd>
                      <span className="whitespace-nowrap">{fmtDate(c.occurredAt, locale)}</span>
                      {/* Phones: the customer column is hidden, so it goes under the date. */}
                      <span dir="ltr" className="block text-start text-xs text-muted sm:hidden">
                        {c.customer || "—"}
                      </span>
                    </PTd>
                    <PTd className="text-muted max-sm:hidden">
                      <span dir="ltr">{c.customer || "—"}</span>
                      {c.nth > 1 ? <span className="ms-2 text-xs">{t("portal.table.renewal", { n: c.nth })}</span> : null}
                    </PTd>
                    <PTd className="text-end tabular-nums max-sm:hidden">{fmtMoney(c.amountCents, c.currency, locale)}</PTd>
                    <PTd className={cn("text-end font-medium tabular-nums", c.status === "reversed" && "text-muted line-through")}>{fmtMoney(c.commissionCents, program.currency, locale)}</PTd>
                    <PTd>
                      <StatusBadge status={c.status} label={t(`portal.status.${c.status}` as MessageKey)} />
                      {c.status === "pending" && program.settings.holdDays > 0 ? (
                        <span className="text-xs text-muted max-sm:mt-1 max-sm:block sm:ms-2">
                          {t("portal.earnings.approvesOn", { date: fmtDate(new Date(Date.parse(c.occurredAt) + program.settings.holdDays * 86_400_000).toISOString(), locale) })}
                        </span>
                      ) : null}
                    </PTd>
                  </tr>
                ))}
              </tbody>
            </PortalTable>
            {pages > 1 ? (
              <nav aria-label={t("portal.earnings.pages")} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="text-muted">{t("portal.earnings.page", { page: fmtNumber(page, locale), pages: fmtNumber(pages, locale) })}</span>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link href={href(status, page - 1)} className="rounded-lg border border-line px-3 py-1.5 hover:border-primary-line">
                      {t("portal.earnings.prev")}
                    </Link>
                  ) : null}
                  {page < pages ? (
                    <Link href={href(status, page + 1)} className="rounded-lg border border-line px-3 py-1.5 hover:border-primary-line">
                      {t("portal.earnings.next")}
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </>
        ) : (
          <EmptyNote>{t("portal.recent.empty")}</EmptyNote>
        )}
      </PortalSection>

      {adjustments.length ? (
        <PortalSection title={t("portal.adjust.title")} description={t("portal.adjust.text")} padded={false}>
          <PortalTable minWidth={520} mobileMinWidth={0}>
            <thead>
              <tr>
                <PTh>{t("portal.table.date")}</PTh>
                <PTh>{t("portal.adjust.reason")}</PTh>
                <PTh className="text-end">{t("portal.table.amount")}</PTh>
                <PTh className="max-sm:hidden">{t("portal.table.status")}</PTh>
              </tr>
            </thead>
            <tbody id="portal-adjustments">
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <PTd className="whitespace-nowrap">{fmtDate(a.createdAt, locale)}</PTd>
                  <PTd className="text-muted">
                    <span dir="auto">{a.reason || "—"}</span>
                    <span className="block text-xs sm:hidden">{a.payoutId ? t("portal.adjust.deducted") : t("portal.adjust.next")}</span>
                  </PTd>
                  <PTd className="text-end font-medium text-red-700 tabular-nums dark:text-red-400">{fmtMoney(a.amountCents, a.currency, locale)}</PTd>
                  <PTd className="text-xs text-muted max-sm:hidden">{a.payoutId ? t("portal.adjust.deducted") : t("portal.adjust.next")}</PTd>
                </tr>
              ))}
            </tbody>
          </PortalTable>
        </PortalSection>
      ) : null}

      <PortalSection title={t("portal.earnings.payouts")} description={t("portal.earnings.payoutsText", { minimum: money(program.settings.minPayoutCents) })} padded={false}>
        {payouts.length ? (
          <PortalTable minWidth={560} mobileMinWidth={0}>
            <thead>
              <tr>
                <PTh>{t("portal.table.date")}</PTh>
                <PTh className="text-end">{t("portal.table.amount")}</PTh>
                <PTh className="max-sm:hidden">{t("portal.payout.method")}</PTh>
                <PTh className="max-sm:hidden">{t("portal.table.reference")}</PTh>
                <PTh>{t("portal.table.status")}</PTh>
              </tr>
            </thead>
            <tbody id="portal-payouts">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <PTd>
                    <span className="whitespace-nowrap">{fmtDate(p.paidAt ?? p.createdAt, locale)}</span>
                    <span className="block text-xs text-muted sm:hidden">{t(`portal.method.${p.method}` as MessageKey)}</span>
                  </PTd>
                  <PTd className="text-end font-medium tabular-nums">{fmtMoney(p.amountCents, p.currency, locale)}</PTd>
                  <PTd className="max-sm:hidden">{t(`portal.method.${p.method}` as MessageKey)}</PTd>
                  <PTd className="font-mono text-xs text-muted max-sm:hidden">
                    <span dir="ltr">{p.reference || "—"}</span>
                  </PTd>
                  <PTd>
                    <StatusBadge status={p.status === "paid" ? "paid" : "draft"} label={p.status === "paid" ? t("portal.status.paid") : t("portal.status.processing")} />
                  </PTd>
                </tr>
              ))}
            </tbody>
          </PortalTable>
        ) : (
          <EmptyNote>{t("portal.earnings.noPayouts")}</EmptyNote>
        )}
      </PortalSection>
    </div>
  );
}
