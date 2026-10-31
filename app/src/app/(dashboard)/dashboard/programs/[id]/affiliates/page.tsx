import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Check, Search, Users } from "lucide-react";
import { bulkAffiliateAction, setAffiliateStatusAction } from "@/app/actions/dashboard/affiliates";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { InviteAffiliateDialog } from "@/components/dashboard/affiliate-forms";
import { CopyField } from "@/components/dashboard/copy";
import { BulkForm, SelectAll } from "@/components/dashboard/merchant-client";
import { AffiliateCell, AffiliateStatusBadge, Money, Num } from "@/components/dashboard/merchant-ui";
import { DashHeader, DTable, DTd, DTh, Empty, LinkTabs, Meter, Pager, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { countUserAffiliates, listProgramAffiliates } from "@/lib/affiliates";
import { formatNumber, intParam } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { canSendMail } from "@/lib/merchant-mail";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { countAffiliates, countAffiliatesByStatus, getAffiliateListStats } from "@/lib/merchant-stats";
import { atLimit, getEntitlements } from "@/lib/plans";
import { portalPath } from "@/lib/programs";
import { baseUrl } from "@/lib/request";
import { isAffiliateStatus } from "@/referral/normalize";
import type { AffiliateStatus } from "@/referral/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; q?: string; page?: string; deleted?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.affiliates") };
}

const PAGE_SIZE = 25;

export default async function AffiliatesPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { user, program } = await requireProgram(id);
  const status: AffiliateStatus | undefined = isAffiliateStatus(query.status) ? query.status : undefined;
  const q = (query.q ?? "").trim().slice(0, 100);
  const page = intParam(query.page, 1);
  const [t, locale, counts, total, affiliates, entitlements, used, mail, origin] = await Promise.all([
    getT(),
    getLocale(),
    countAffiliatesByStatus(program.id),
    countAffiliates(program.id, { status, search: q }),
    listProgramAffiliates(program.id, { status, search: q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getEntitlements(user),
    countUserAffiliates(user.id),
    canSendMail(),
    baseUrl(),
  ]);
  const stats = await getAffiliateListStats(
    program.id,
    affiliates.map((a) => a.id),
  );
  const lc = locale.code;
  const base = programPath(program.id, "affiliates");
  const href = (over: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status, q: q || undefined, page: undefined as number | undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) sp.set(k, String(v));
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const full = atLimit(used, entitlements.maxAffiliates);
  const portalUrl = `${origin}${portalPath(program.slug)}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {query.deleted ? <RefreshOnce cleanUrl={base} /> : null}
      <DashHeader
        title={t("dash.nav.affiliates")}
        description={plural(t, "dash.aff.count", counts.all, { n: formatNumber(counts.all, lc) })}
        actions={<InviteAffiliateDialog programId={program.id} canMail={mail} disabled={full} portalUrl={portalUrl} />}
      />
      {query.deleted ? (
        <Alert tone="success" className="mb-5">
          {t("dash.aff.deleted")}
        </Alert>
      ) : null}
      {entitlements.maxAffiliates > 0 ? (
        <div className="mb-5 rounded-xl border border-line bg-surface p-4">
          <Meter
            label={t("dash.aff.planUsage")}
            used={used}
            limit={entitlements.maxAffiliates}
            usedText={formatNumber(used, lc)}
            limitText={formatNumber(entitlements.maxAffiliates, lc)}
            critical
          />
          {full ? (
            <p className="mt-2 text-xs text-muted">
              {t("dash.merr.affiliateLimit", { n: entitlements.maxAffiliates })}{" "}
              <Link href="/pricing" className="font-medium text-primary hover:underline">
                {t("dash.banner.cta")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {counts.all === 0 ? (
        <Panel>
          <Empty icon={<Users />} title={t("dash.aff.emptyTitle")} action={<InviteAffiliateDialog programId={program.id} canMail={mail} disabled={full} portalUrl={portalUrl} />}>
            <p>{t("dash.aff.emptyText")}</p>
            <div className="mx-auto mt-4 max-w-md text-start">
              <CopyField value={portalUrl} label={t("dash.aff.portalUrl")} />
            </div>
          </Empty>
        </Panel>
      ) : (
        <Panel padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <LinkTabs
              label={t("dash.aff.filter")}
              items={[
                { href: href({ status: undefined }), label: t("dash.aff.all"), active: !status, count: counts.all },
                { href: href({ status: "pending" }), label: t("dash.aff.status.pending"), active: status === "pending", count: counts.pending },
                { href: href({ status: "approved" }), label: t("dash.aff.status.approved"), active: status === "approved", count: counts.approved },
                { href: href({ status: "blocked" }), label: t("dash.aff.status.blocked"), active: status === "blocked", count: counts.blocked },
              ]}
            />
            <form method="get" action={base} className="flex w-full gap-2 sm:w-auto" role="search">
              {status ? <input type="hidden" name="status" value={status} /> : null}
              <div className="relative min-w-0 flex-1 sm:w-64">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input name="q" type="search" defaultValue={q} placeholder={t("dash.aff.search")} aria-label={t("dash.aff.search")} className="ps-9" />
              </div>
              <Button type="submit" variant="outline">
                {t("dash.aff.searchSubmit")}
              </Button>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/50 px-4 py-2.5">
            <BulkForm id="aff-bulk" action={bulkAffiliateAction} fields={{ program_id: program.id }}>
              <span className="text-xs text-muted">{t("dash.aff.selected")}</span>
              <Button type="submit" name="status" value="approved" variant="outline" size="sm">
                <Check aria-hidden />
                {t("dash.aff.approve")}
              </Button>
              <Button type="submit" name="status" value="blocked" variant="ghost" size="sm">
                <Ban aria-hidden />
                {t("dash.aff.block")}
              </Button>
            </BulkForm>
            {counts.pending > 0 ? (
              <ActionButton action={bulkAffiliateAction} fields={{ program_id: program.id, status: "approved", all_pending: "1" }} variant="secondary" className="ms-auto" showSuccess>
                <Check aria-hidden />
                {plural(t, "dash.aff.approveAllPending", counts.pending, { n: counts.pending })}
              </ActionButton>
            ) : null}
          </div>

          {affiliates.length ? (
            <DTable minWidth={860} label={t("dash.nav.affiliates")}>
              <thead>
                <tr>
                  <DTh className="w-10">
                    <SelectAll form="aff-bulk" label={t("dash.aff.selectAll")} />
                  </DTh>
                  <DTh>{t("dash.aff.col.affiliate")}</DTh>
                  <DTh>{t("dash.aff.col.code")}</DTh>
                  <DTh>{t("dash.aff.col.status")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.clicks")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.conversions")}</DTh>
                  <DTh className="text-end">{t("dash.prog.kpi.revenue")}</DTh>
                  <DTh className="text-end">{t("dash.aff.col.unpaid")}</DTh>
                  <DTh className="text-end">
                    <span className="sr-only">{t("dash.aff.col.actions")}</span>
                  </DTh>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => {
                  const s = stats.get(a.id)!;
                  return (
                    <tr key={a.id} className="hover:bg-paper/60">
                      <DTd>
                        <input type="checkbox" name="affiliate_ids" value={a.id} form="aff-bulk" aria-label={t("dash.aff.selectOne", { name: a.name })} className="size-4 rounded border-line accent-[var(--primary)]" />
                      </DTd>
                      <DTd className="max-w-64">
                        <AffiliateCell href={programPath(program.id, `affiliates/${a.id}`)} name={a.name} sub={a.email} />
                      </DTd>
                      <DTd>
                        <code dir="ltr" className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">
                          {a.code}
                        </code>
                        {a.commissionOverride ? (
                          <span className="mt-0.5 block text-[11px] font-medium whitespace-nowrap text-primary" title={t("dash.aff.override")}>
                            {t("dash.aff.customRate")}
                          </span>
                        ) : null}
                      </DTd>
                      <DTd>
                        <AffiliateStatusBadge status={a.status} t={t} />
                      </DTd>
                      <DTd className="text-end">
                        <Num value={s.clicks} locale={lc} />
                      </DTd>
                      <DTd className="text-end">
                        <Num value={s.conversions} locale={lc} />
                      </DTd>
                      <DTd className="text-end">
                        <Money cents={s.revenueCents} currency={program.currency} locale={lc} />
                      </DTd>
                      <DTd className="text-end font-medium">
                        <Money cents={s.unpaidCents} currency={program.currency} locale={lc} />
                      </DTd>
                      <DTd className="text-end">
                        <div className="flex justify-end gap-1">
                          {a.status !== "approved" ? (
                            <ActionButton action={setAffiliateStatusAction} fields={{ program_id: program.id, affiliate_id: a.id, status: "approved" }} label={t("dash.aff.approveOne", { name: a.name })} buttonClassName="px-2">
                              <Check aria-hidden />
                            </ActionButton>
                          ) : (
                            <ActionButton
                              action={setAffiliateStatusAction}
                              fields={{ program_id: program.id, affiliate_id: a.id, status: "blocked" }}
                              variant="ghost"
                              confirmText={t("dash.aff.blockConfirm", { name: a.name })}
                              label={t("dash.aff.blockOne", { name: a.name })}
                              buttonClassName="px-2"
                            >
                              <Ban aria-hidden />
                            </ActionButton>
                          )}
                        </div>
                      </DTd>
                    </tr>
                  );
                })}
              </tbody>
            </DTable>
          ) : (
            <Empty icon={<Search />} title={t("dash.aff.noMatch")}>
              <Link href={base} className="font-medium text-primary hover:underline">
                {t("dash.aff.clearFilters")}
              </Link>
            </Empty>
          )}
          <Pager
            page={page}
            pages={pages}
            href={(p) => href({ page: p })}
            labels={{
              summary: t("dash.aff.pageSummary", { page, pages, total: formatNumber(total, lc) }),
              previous: t("dash.pager.previous"),
              next: t("dash.pager.next"),
              nav: t("dash.pager.label"),
            }}
          />
        </Panel>
      )}
    </>
  );
}
