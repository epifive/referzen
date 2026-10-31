import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Check, Clock, ExternalLink, HandCoins, Receipt, Trash2, Wallet } from "lucide-react";
import { deleteAffiliateAction, setAffiliateStatusAction } from "@/app/actions/dashboard/affiliates";
import { ActionButton } from "@/components/dashboard/actions";
import { AffiliateEditForm, ResendInviteForm } from "@/components/dashboard/affiliate-forms";
import { ConversionActions, ReasonList } from "@/components/dashboard/conversion-forms";
import { CopyField } from "@/components/dashboard/copy";
import { AffiliateStatusBadge, ConversionStatusBadge, FlagBadges, Kpi, KpiGrid, maskedDetails, methodLabel, Money, Num, sourceLabel } from "@/components/dashboard/merchant-ui";
import { ProgramChart } from "@/components/dashboard/program-chart";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getOwnedAffiliate } from "@/lib/affiliates";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { type MessageKey, plural } from "@/lib/i18n/messages";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { countReferrals, getAffiliateClicks, getCommissionTotals, getDailySeries, listAffiliatePayouts, listAffiliateReferrals, listConversions } from "@/lib/merchant-stats";
import { getAffiliateAdjustments } from "@/lib/payouts";
import { getOwnedProgram, portalPath } from "@/lib/programs";
import { baseUrl } from "@/lib/request";
import { describeRate, referralLink } from "@/referral/normalize";

type Props = { params: Promise<{ id: string; affiliateId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id, affiliateId }, user, t] = await Promise.all([params, getCurrentUser(), getT()]);
  const program = user ? await getOwnedProgram(Number(id), user.id) : undefined;
  const affiliate = program ? await getOwnedAffiliate(program.id, Number(affiliateId)) : undefined;
  return { title: affiliate?.name ?? t("dash.nav.affiliates") };
}

export default async function AffiliatePage({ params }: Props) {
  const { id, affiliateId } = await params;
  const { program } = await requireProgram(id);
  const affiliate = await getOwnedAffiliate(program.id, Number(affiliateId));
  if (!affiliate) notFound();
  const [t, locale, clicks, referrals, totals, conversions, payouts, leads, series, origin, adjustments] = await Promise.all([
    getT(),
    getLocale(),
    getAffiliateClicks(program.id, affiliate.id),
    countReferrals(program.id, affiliate.id),
    getCommissionTotals(program.id, affiliate.id),
    listConversions(program.id, { affiliateId: affiliate.id }, { limit: 15 }),
    listAffiliatePayouts(program.id, affiliate.id, 10),
    listAffiliateReferrals(program.id, affiliate.id, 8),
    getDailySeries(program.id, 30, affiliate.id),
    baseUrl(),
    getAffiliateAdjustments(program.id, affiliate.id, 10),
  ]);
  const lc = locale.code;
  const fields = { program_id: program.id, affiliate_id: affiliate.id };
  const param = program.settings.refParams[0] ?? "ref";
  const link = referralLink(program.domain, affiliate.code, { param });
  const deleted = affiliate.email.endsWith("@invalid");
  const o = affiliate.commissionOverride;
  const rateText = o ? describeRate(o.commissionType ?? program.settings.commissionType, o.rate ?? program.settings.rate, program.currency) : describeRate(program.settings.commissionType, program.settings.rate, program.currency);
  const masked = maskedDetails(affiliate.payoutMethod, affiliate.payoutDetails);
  const earned = totals.pendingCents + totals.approvedCents + totals.paidCents;

  return (
    <>
      <ReasonList />
      <Link href={programPath(program.id, "affiliates")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.aff.back")}
      </Link>
      <DashHeader
        title={affiliate.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span dir="ltr">{affiliate.email}</span>
            <AffiliateStatusBadge status={affiliate.status} t={t} />
            {o ? <Badge tone="primary">{t("dash.aff.customRateValue", { rate: rateText })}</Badge> : null}
          </span>
        }
        actions={
          deleted ? null : (
            <>
              {affiliate.status !== "approved" ? (
                <ActionButton action={setAffiliateStatusAction} fields={{ ...fields, status: "approved" }} variant="primary" size="md">
                  <Check aria-hidden />
                  {t("dash.aff.approve")}
                </ActionButton>
              ) : null}
              {affiliate.status !== "blocked" ? (
                <ActionButton action={setAffiliateStatusAction} fields={{ ...fields, status: "blocked" }} size="md" confirmText={t("dash.aff.blockConfirm", { name: affiliate.name })}>
                  <Ban aria-hidden />
                  {t("dash.aff.block")}
                </ActionButton>
              ) : null}
              <ActionButton action={deleteAffiliateAction} fields={{ ...fields, redirect: "1" }} variant="ghost" size="md" confirmText={t("dash.aff.deleteConfirm", { name: affiliate.name })}>
                <Trash2 aria-hidden />
                <span className="max-sm:sr-only">{t("dash.aff.delete")}</span>
              </ActionButton>
            </>
          )
        }
      />

      {affiliate.status === "pending" ? (
        <Alert tone="warning" className="mb-6" title={t("dash.aff.pendingTitle")}>
          {t("dash.aff.pendingText")}
        </Alert>
      ) : affiliate.status === "blocked" && !deleted ? (
        <Alert tone="error" className="mb-6" title={t("dash.aff.blockedTitle")}>
          {t("dash.aff.blockedText")}
        </Alert>
      ) : null}

      <KpiGrid className="mb-6 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("dash.prog.kpi.clicks")} value={<Num value={clicks.clicks} locale={lc} />} hint={t("dash.aff.allTime")} />
        <Kpi label={t("dash.prog.kpi.referrals")} value={<Num value={referrals.leads} locale={lc} />} hint={plural(t, "dash.aff.convertedLeads", referrals.converted)} />
        <Kpi label={t("dash.prog.kpi.conversions")} value={<Num value={conversions.total} locale={lc} />} hint={t("dash.aff.allStatuses")} />
        <Kpi accent="bg-amber-500" label={t("dash.prog.kpi.pending")} value={<Money cents={totals.pendingCents} currency={program.currency} locale={lc} />} />
        <Kpi accent="bg-sky-500" label={t("dash.prog.kpi.approved")} value={<Money cents={totals.approvedCents} currency={program.currency} locale={lc} />} />
        <Kpi accent="bg-emerald-500" label={t("dash.prog.kpi.paid")} value={<Money cents={totals.paidCents} currency={program.currency} locale={lc} />} hint={t("dash.aff.allTime")} />
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("dash.aff.activity")} description={t("dash.prog.chartText", { n: 30 })}>
            <ProgramChart data={series} currency={program.currency} locale={lc} />
          </Panel>

          <Panel
            title={t("dash.nav.conversions")}
            padded={false}
            actions={
              conversions.total > conversions.rows.length ? (
                <Link href={`${programPath(program.id, "conversions")}?affiliate=${affiliate.id}`} className="text-sm font-medium text-primary hover:underline">
                  {t("dash.aff.allConversions", { n: conversions.total })}
                </Link>
              ) : null
            }
          >
            {conversions.rows.length ? (
              <DTable minWidth={660} dense label={t("dash.nav.conversions")}>
                <thead>
                  <tr>
                    <DTh>{t("dash.conv.col.date")}</DTh>
                    <DTh>{t("dash.conv.col.order")}</DTh>
                    <DTh className="text-end">{t("dash.conv.col.amount")}</DTh>
                    <DTh className="text-end">{t("dash.conv.col.commission")}</DTh>
                    <DTh>{t("dash.conv.col.status")}</DTh>
                    <DTh className="text-end">
                      <span className="sr-only">{t("dash.aff.col.actions")}</span>
                    </DTh>
                  </tr>
                </thead>
                <tbody>
                  {conversions.rows.map((c) => (
                    <tr key={c.id}>
                      <DTd className="whitespace-nowrap text-muted">{formatDateTime(c.occurredAt, lc, false)}</DTd>
                      <DTd className="max-w-44">
                        <p dir="ltr" className="truncate text-start font-mono text-[12px]">
                          {c.externalId}
                        </p>
                        <p className="text-xs text-muted">{sourceLabel(c.source, t)}</p>
                        <FlagBadges flags={c.flags} t={t} className="mt-1" />
                      </DTd>
                      <DTd className="text-end">
                        <Money cents={c.amountCents} currency={c.currency} locale={lc} />
                      </DTd>
                      <DTd className="text-end font-semibold">
                        <Money cents={c.commissionCents} currency={program.currency} locale={lc} className={c.status === "reversed" ? "text-muted line-through" : undefined} />
                      </DTd>
                      <DTd>
                        <ConversionStatusBadge status={c.status} t={t} />
                      </DTd>
                      <DTd className="text-end">
                        <ConversionActions programId={program.id} currency={program.currency} conversion={c} />
                      </DTd>
                    </tr>
                  ))}
                </tbody>
              </DTable>
            ) : (
              <Empty icon={<Receipt />} title={t("dash.aff.noConversions")}>
                {t("dash.aff.noConversionsText")}
              </Empty>
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={t("dash.aff.payouts")} padded={false}>
              {payouts.length ? (
                <ul className="divide-y divide-line">
                  {payouts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <Money cents={Number(p.amount_cents)} currency={p.currency} locale={lc} className="font-semibold" />
                        <p className="truncate text-xs text-muted">
                          {methodLabel(p.method as "paypal", t)} · {formatDateTime(p.paid_at ?? p.created_at, lc, false)}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </p>
                      </div>
                      {p.batch_id ? (
                        <Link href={programPath(program.id, `payouts/${p.batch_id}`)} className="shrink-0">
                          <Badge tone={p.status === "paid" ? "success" : "warning"}>{t(`dash.pay.status.${p.status}` as MessageKey)}</Badge>
                        </Link>
                      ) : (
                        <Badge tone={p.status === "paid" ? "success" : "warning"}>{t(`dash.pay.status.${p.status}` as MessageKey)}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={<HandCoins />} title={t("dash.aff.noPayouts")} />
              )}
            </Panel>
            <Panel title={t("dash.aff.leads")} padded={false}>
              {leads.length ? (
                <ul className="divide-y divide-line">
                  {leads.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p dir="ltr" className="truncate text-start">
                          {r.email ?? r.customer_ref ?? t("dash.aff.anonymousLead")}
                        </p>
                        <p className="text-xs text-muted">{formatRelative(r.created_at, lc)}</p>
                      </div>
                      <Badge tone={r.status === "converted" ? "success" : "neutral"}>{r.status === "converted" ? t("dash.aff.leadConverted") : t("dash.aff.leadOpen")}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={<Clock />} title={t("dash.aff.noLeads")} />
              )}
            </Panel>
          </div>

          {!deleted ? (
            <Panel title={t("dash.aff.profile")} description={t("dash.aff.profileText")}>
              <AffiliateEditForm
                programId={program.id}
                affiliate={affiliate}
                currency={program.currency}
                programRateText={describeRate(program.settings.commissionType, program.settings.rate, program.currency)}
              />
            </Panel>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Panel title={t("dash.aff.links")}>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">{t("dash.aff.referralLink")}</p>
                <CopyField value={link} label={t("dash.aff.referralLink")} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted">{t("dash.aff.code")}</p>
                  <code dir="ltr" className="font-mono font-semibold">
                    {affiliate.code}
                  </code>
                </div>
                <div>
                  <p className="text-xs text-muted">{t("dash.aff.coupon")}</p>
                  <code dir="ltr" className="font-mono font-semibold">
                    {affiliate.couponCode || "—"}
                  </code>
                </div>
              </div>
              <p className="text-xs text-muted">
                {t("dash.aff.commission")}: <bdi className="font-medium text-ink">{rateText}</bdi>
                {" · "}
                {t("dash.aff.earnedTotal")}: <Money cents={earned} currency={program.currency} locale={lc} className="font-medium text-ink" />
              </p>
            </div>
          </Panel>

          <Panel title={t("dash.aff.payoutDetails")}>
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper text-muted">
                <Wallet className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">{methodLabel(affiliate.payoutMethod, t)}</p>
                <p dir="ltr" className="truncate text-start text-muted">
                  {masked || t("dash.aff.noPayoutDetails")}
                </p>
              </div>
            </div>
            {!masked ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{t("dash.aff.noPayoutDetailsHint")}</p> : null}
          </Panel>

          {adjustments.length ? (
            <Panel title={t("dash.aff.adjustments")} description={t("dash.aff.adjustmentsText")} padded={false}>
              <ul className="divide-y divide-line" id="affiliate-adjustments">
                {adjustments.map((a) => {
                  const batchId = a.payoutId ? payouts.find((p) => p.id === a.payoutId)?.batch_id : null;
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p dir="auto" className="text-start break-words">
                          {a.reason || "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatDateTime(a.createdAt, lc, false)} ·{" "}
                          {!a.payoutId ? (
                            <span className="text-amber-700 dark:text-amber-400">{t("dash.aff.adjustPending")}</span>
                          ) : batchId ? (
                            <Link href={programPath(program.id, `payouts/${batchId}`)} className="hover:text-primary hover:underline">
                              {t("dash.aff.adjustDeducted")}
                            </Link>
                          ) : (
                            t("dash.aff.adjustDeducted")
                          )}
                        </p>
                      </div>
                      <Money cents={a.amountCents} currency={a.currency} locale={lc} className="shrink-0 font-semibold text-red-700 dark:text-red-400" />
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          <Panel title={t("dash.aff.account")}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t("dash.aff.joined")}</dt>
                <dd>{formatDateTime(affiliate.createdAt, lc, false)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t("dash.aff.lastLogin")}</dt>
                <dd>{affiliate.lastLoginAt ? formatRelative(affiliate.lastLoginAt, lc) : t("dash.api.never")}</dd>
              </div>
              {affiliate.website ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("dash.aff.website")}</dt>
                  <dd className="min-w-0 truncate">
                    <a href={/^https?:\/\//.test(affiliate.website) ? affiliate.website : `https://${affiliate.website}`} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-primary hover:underline">
                      {affiliate.website.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            {!affiliate.hasPassword && !deleted ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs text-muted">{t("dash.aff.noPassword")}</p>
                <ResendInviteForm programId={program.id} affiliateId={affiliate.id} />
              </div>
            ) : null}
            <a href={`${origin}${portalPath(program.slug)}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <ExternalLink className="size-3.5" aria-hidden />
              {t("dash.prog.openPortal")}
            </a>
          </Panel>

          {affiliate.notes ? (
            <Panel title={t("dash.aff.notes")}>
              <p dir="auto" className="text-sm whitespace-pre-line text-muted">
                {affiliate.notes}
              </p>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
