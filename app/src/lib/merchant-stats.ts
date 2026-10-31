import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import { toConversionRecord, type ConversionRecord } from "./conversions";
import { getClickStats, getClicksByAffiliate } from "./portal-stats";
import type { ConversionSource, ConversionStatus } from "@/referral/types";

/**
 * Read-only statistics for the merchant dashboard. Every click number comes from
 * src/lib/portal-stats.ts (click_daily for summarised days + raw clicks after them), so the
 * merchant dashboard and the affiliate portal always show the same counts. Days are UTC.
 */

const DAY_MS = 86_400_000;

/** UTC day (YYYY-MM-DD) of an instant. */
export function dayOf(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The last `days` UTC days, oldest first (today included). */
export function periodDays(days: number, nowMs = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayOf(nowMs - i * DAY_MS));
  return out;
}

/** Start (ISO) and first day of the last `days` days; `offset` periods back for comparisons. */
export function periodRange(days: number, offset = 0, nowMs = Date.now()): { fromDay: string; toDay: string; fromIso: string; toIso: string } {
  const end = nowMs - offset * days * DAY_MS;
  const fromDay = dayOf(end - (days - 1) * DAY_MS);
  const toDay = dayOf(end);
  return { fromDay, toDay, fromIso: `${fromDay}T00:00:00.000Z`, toIso: `${toDay}T23:59:59.999Z` };
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Sum of order amounts that count as revenue: not reversed, and paid in the program currency
 * (conversions flagged currency_mismatch are in another currency and can't be added up).
 */
const revenueSum = () => sql<number>`sum(case when status <> 'reversed' and flags not like '%currency_mismatch%' then amount_cents else 0 end)`;
/** Commissions earned (not reversed); always in the program currency. */
const commissionSum = () => sql<number>`sum(case when status <> 'reversed' then commission_cents else 0 end)`;
const conversionCount = () => sql<number>`sum(case when status <> 'reversed' then 1 else 0 end)`;

const ALL_TIME = { fromDay: "2000-01-01", toDay: "2999-12-31" };

export interface CommissionTotals {
  pendingCents: number;
  /** Approved and not paid yet (including draft payouts). */
  approvedCents: number;
  paidCents: number;
  reversedCents: number;
}

/** All-time commission totals of a program (or one affiliate) by conversion status. */
export async function getCommissionTotals(programId: number, affiliateId?: number): Promise<CommissionTotals> {
  const db = await getDb();
  const rows = await db
    .selectFrom("conversions")
    .select((eb) => ["status", eb.fn.sum<number>("commission_cents").as("total")])
    .where("program_id", "=", programId)
    .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
    .groupBy("status")
    .execute();
  const get = (s: ConversionStatus) => num(rows.find((r) => r.status === s)?.total);
  return { pendingCents: get("pending"), approvedCents: get("approved"), paidCents: get("paid"), reversedCents: get("reversed") };
}

export interface PeriodKpis {
  clicks: number;
  uniqueClicks: number;
  referrals: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  reversed: number;
}

/** Clicks, leads, conversions and revenue of a program (or affiliate) in a date range. Reversed conversions are left out. */
export async function getPeriodKpis(programId: number, range: { fromDay: string; toDay: string }, affiliateId?: number): Promise<PeriodKpis> {
  const db = await getDb();
  const from = `${range.fromDay}T00:00:00.000Z`;
  const to = `${range.toDay}T23:59:59.999Z`;
  const [cells, referrals, conv] = await Promise.all([
    getClickStats({ programId, affiliateId, fromDay: range.fromDay, toDay: range.toDay }),
    db
      .selectFrom("referrals")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("program_id", "=", programId)
      .where("created_at", ">=", from)
      .where("created_at", "<=", to)
      .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
      .executeTakeFirst(),
    db
      .selectFrom("conversions")
      .select((eb) => [
        conversionCount().as("n"),
        sql<number>`sum(case when status = 'reversed' then 1 else 0 end)`.as("rev"),
        revenueSum().as("amount"),
        commissionSum().as("commission"),
        eb.fn.countAll<number>().as("all"),
      ])
      .where("program_id", "=", programId)
      .where("occurred_at", ">=", from)
      .where("occurred_at", "<=", to)
      .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
      .executeTakeFirst(),
  ]);
  return {
    clicks: cells.clicks,
    uniqueClicks: cells.uniqueClicks,
    referrals: num(referrals?.n),
    conversions: num(conv?.n),
    revenueCents: num(conv?.amount),
    commissionCents: num(conv?.commission),
    reversed: num(conv?.rev),
  };
}

/**
 * Conversions, revenue and commission of several programs over the same UTC days as the
 * merchant dashboard (periodRange()): Admin → Programs shows the same numbers as the owner.
 */
export async function getProgramsPeriodTotals(programIds: number[], range: { fromDay: string; toDay: string }): Promise<Map<number, { n: number; revenue: number; commission: number }>> {
  if (!programIds.length) return new Map();
  const db = await getDb();
  const rows = await db
    .selectFrom("conversions")
    .select(["program_id", conversionCount().as("n"), revenueSum().as("revenue"), commissionSum().as("commission")])
    .where("program_id", "in", programIds)
    .where("occurred_at", ">=", `${range.fromDay}T00:00:00.000Z`)
    .where("occurred_at", "<=", `${range.toDay}T23:59:59.999Z`)
    .groupBy("program_id")
    .execute();
  return new Map(rows.map((r) => [r.program_id, { n: num(r.n), revenue: num(r.revenue), commission: num(r.commission) }]));
}

export interface SeriesPoint {
  day: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
}

/** One point per day of the range: clicks, conversions and revenue (reversed conversions excluded). */
export async function getDailySeries(programId: number, days: number, affiliateId?: number): Promise<SeriesPoint[]> {
  const range = periodRange(days);
  const db = await getDb();
  const dayExpr = sql<string>`substr(occurred_at, 1, 10)`;
  const [cells, conv] = await Promise.all([
    getClickStats({ programId, affiliateId, fromDay: range.fromDay, toDay: range.toDay }),
    db
      .selectFrom("conversions")
      .select((eb) => [dayExpr.as("day"), eb.fn.countAll<number>().as("n"), revenueSum().as("amount")])
      .where("program_id", "=", programId)
      .where("status", "!=", "reversed")
      .where("occurred_at", ">=", range.fromIso)
      .where("occurred_at", "<=", range.toIso)
      .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
      .groupBy(dayExpr)
      .execute(),
  ]);
  const byDay = new Map<string, SeriesPoint>(periodDays(days).map((day) => [day, { day, clicks: 0, conversions: 0, revenueCents: 0 }]));
  for (const [day, c] of cells.byDay) {
    const p = byDay.get(day);
    if (p) p.clicks += c.clicks;
  }
  for (const r of conv) {
    const p = byDay.get(String(r.day));
    if (p) {
      p.conversions = num(r.n);
      p.revenueCents = num(r.amount);
    }
  }
  return [...byDay.values()];
}

export interface AffiliateRow {
  affiliateId: number;
  name: string;
  email: string;
  code: string;
  status: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
}

/** Best affiliates of a period by revenue (then conversions, then clicks). */
export async function getTopAffiliates(programId: number, days: number, limit = 8): Promise<AffiliateRow[]> {
  const range = periodRange(days);
  const db = await getDb();
  const [cells, conv] = await Promise.all([
    getClicksByAffiliate({ programId, fromDay: range.fromDay, toDay: range.toDay }),
    db
      .selectFrom("conversions")
      .select((eb) => ["affiliate_id", eb.fn.countAll<number>().as("n"), revenueSum().as("amount"), eb.fn.sum<number>("commission_cents").as("commission")])
      .where("program_id", "=", programId)
      .where("status", "!=", "reversed")
      .where("occurred_at", ">=", range.fromIso)
      .where("occurred_at", "<=", range.toIso)
      .groupBy("affiliate_id")
      .execute(),
  ]);
  const stats = new Map<number, { clicks: number; conversions: number; revenueCents: number; commissionCents: number }>();
  const get = (id: number) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { clicks: 0, conversions: 0, revenueCents: 0, commissionCents: 0 }));
    return s;
  };
  for (const [id, c] of cells) get(id).clicks += c.clicks;
  for (const r of conv) Object.assign(get(r.affiliate_id), { conversions: num(r.n), revenueCents: num(r.amount), commissionCents: num(r.commission) });
  const ranked = [...stats.entries()]
    .filter(([, s]) => s.clicks > 0 || s.conversions > 0)
    .sort((a, b) => b[1].revenueCents - a[1].revenueCents || b[1].conversions - a[1].conversions || b[1].clicks - a[1].clicks)
    .slice(0, limit);
  if (!ranked.length) return [];
  const affiliates = await db
    .selectFrom("affiliates")
    .select(["id", "name", "email", "code", "status"])
    .where("program_id", "=", programId)
    .where("id", "in", ranked.map(([id]) => id))
    .execute();
  const byId = new Map(affiliates.map((a) => [a.id, a]));
  return ranked
    .filter(([id]) => byId.has(id))
    .map(([id, s]) => {
      const a = byId.get(id)!;
      return { affiliateId: id, name: a.name, email: a.email, code: a.code, status: a.status, ...s };
    });
}

export interface AffiliateListStats {
  clicks: number;
  conversions: number;
  revenueCents: number;
  /** Commission earned (pending + approved + paid). */
  earnedCents: number;
  /** Pending + approved, not paid yet. */
  unpaidCents: number;
}

/** All-time numbers for a page of affiliates (affiliates list). */
export async function getAffiliateListStats(programId: number, affiliateIds: number[]): Promise<Map<number, AffiliateListStats>> {
  const out = new Map<number, AffiliateListStats>(affiliateIds.map((id) => [id, { clicks: 0, conversions: 0, revenueCents: 0, earnedCents: 0, unpaidCents: 0 }]));
  if (!affiliateIds.length) return out;
  const db = await getDb();
  const [cells, conv] = await Promise.all([
    getClicksByAffiliate({ programId, ...ALL_TIME }),
    db
      .selectFrom("conversions")
      .select([
        "affiliate_id",
        conversionCount().as("n"),
        revenueSum().as("amount"),
        commissionSum().as("earned"),
        sql<number>`sum(case when status in ('pending', 'approved') then commission_cents else 0 end)`.as("unpaid"),
      ])
      .where("program_id", "=", programId)
      .where("affiliate_id", "in", affiliateIds)
      .groupBy("affiliate_id")
      .execute(),
  ]);
  for (const [id, c] of cells) {
    const s = out.get(id);
    if (s) s.clicks += c.clicks;
  }
  for (const r of conv) {
    const s = out.get(r.affiliate_id);
    if (s) Object.assign(s, { conversions: num(r.n), revenueCents: num(r.amount), earnedCents: num(r.earned), unpaidCents: num(r.unpaid) });
  }
  return out;
}

/** All-time clicks of one affiliate. */
export async function getAffiliateClicks(programId: number, affiliateId: number): Promise<{ clicks: number; unique: number }> {
  const stats = await getClickStats({ programId, affiliateId, ...ALL_TIME });
  return { clicks: stats.clicks, unique: stats.uniqueClicks };
}

export async function countReferrals(programId: number, affiliateId?: number): Promise<{ leads: number; converted: number }> {
  const db = await getDb();
  const rows = await db
    .selectFrom("referrals")
    .select((eb) => ["status", eb.fn.countAll<number>().as("n")])
    .where("program_id", "=", programId)
    .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
    .groupBy("status")
    .execute();
  const leads = rows.reduce((s, r) => s + num(r.n), 0);
  return { leads, converted: num(rows.find((r) => r.status === "converted")?.n) };
}

// ── Conversions list ──

export interface ConversionFilters {
  status?: ConversionStatus;
  source?: ConversionSource;
  affiliateId?: number;
  /** YYYY-MM-DD (inclusive). */
  from?: string;
  to?: string;
  /** Only conversions with fraud / trust flags. */
  flagged?: boolean;
  /** Order id or customer reference (substring). */
  q?: string;
}

export interface ConversionRow extends ConversionRecord {
  affiliateName: string;
  affiliateEmail: string;
  affiliateCode: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Conversions of a program, newest first, with the affiliate's name. */
export async function listConversions(
  programId: number,
  filters: ConversionFilters,
  options: { limit?: number; offset?: number } = {},
): Promise<{ rows: ConversionRow[]; total: number }> {
  const db = await getDb();
  const q = filters.q?.trim().slice(0, 100);
  const base = db
    .selectFrom("conversions")
    .innerJoin("affiliates", "affiliates.id", "conversions.affiliate_id")
    .where("conversions.program_id", "=", programId)
    .$if(Boolean(filters.status), (qb) => qb.where("conversions.status", "=", filters.status!))
    .$if(Boolean(filters.source), (qb) => qb.where("conversions.source", "=", filters.source!))
    .$if(Boolean(filters.affiliateId), (qb) => qb.where("conversions.affiliate_id", "=", filters.affiliateId!))
    .$if(Boolean(filters.from && DAY_RE.test(filters.from)), (qb) => qb.where("conversions.occurred_at", ">=", `${filters.from}T00:00:00.000Z`))
    .$if(Boolean(filters.to && DAY_RE.test(filters.to)), (qb) => qb.where("conversions.occurred_at", "<=", `${filters.to}T23:59:59.999Z`))
    .$if(Boolean(filters.flagged), (qb) => qb.where("conversions.flags", "!=", ""))
    .$if(Boolean(q), (qb) =>
      qb.where((eb) =>
        eb.or([
          eb("conversions.external_id", "like", `%${q}%`),
          eb("conversions.customer_ref", "like", `%${q}%`),
          eb("affiliates.email", "like", `%${q!.toLowerCase()}%`),
          eb("affiliates.code", "like", `%${q!.toLowerCase()}%`),
        ]),
      ),
    );
  const [rows, count] = await Promise.all([
    base
      .selectAll("conversions")
      .select(["affiliates.name as affiliate_name", "affiliates.email as affiliate_email", "affiliates.code as affiliate_code"])
      .orderBy("conversions.occurred_at", "desc")
      .orderBy("conversions.id", "desc")
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 10_000))
      .offset(Math.max(options.offset ?? 0, 0))
      .execute(),
    base.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return {
    rows: rows.map((r) => ({ ...toConversionRecord(r), affiliateName: r.affiliate_name, affiliateEmail: r.affiliate_email, affiliateCode: r.affiliate_code })),
    total: num(count?.n),
  };
}

/** Conversion counts by status (tabs of the conversions page). */
export async function countConversionsByStatus(programId: number): Promise<Record<ConversionStatus | "all", number>> {
  const db = await getDb();
  const rows = await db
    .selectFrom("conversions")
    .select((eb) => ["status", eb.fn.countAll<number>().as("n")])
    .where("program_id", "=", programId)
    .groupBy("status")
    .execute();
  const get = (s: string) => num(rows.find((r) => r.status === s)?.n);
  return { all: rows.reduce((s, r) => s + num(r.n), 0), pending: get("pending"), approved: get("approved"), paid: get("paid"), reversed: get("reversed") };
}

/** Affiliate counts by status (tabs of the affiliates page). */
export async function countAffiliatesByStatus(programId: number): Promise<{ all: number; pending: number; approved: number; blocked: number }> {
  const db = await getDb();
  const rows = await db
    .selectFrom("affiliates")
    .select((eb) => ["status", eb.fn.countAll<number>().as("n")])
    .where("program_id", "=", programId)
    .groupBy("status")
    .execute();
  const get = (s: string) => num(rows.find((r) => r.status === s)?.n);
  return { all: rows.reduce((s, r) => s + num(r.n), 0), pending: get("pending"), approved: get("approved"), blocked: get("blocked") };
}

/** Count affiliates matching a search (for paging). */
export async function countAffiliates(programId: number, options: { status?: string; search?: string }): Promise<number> {
  const db = await getDb();
  const search = options.search?.trim().toLowerCase().slice(0, 100);
  const row = await db
    .selectFrom("affiliates")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("program_id", "=", programId)
    .$if(Boolean(options.status), (qb) => qb.where("status", "=", options.status as "pending"))
    .$if(Boolean(search), (qb) => qb.where((eb) => eb.or([eb("email", "like", `%${search}%`), eb("name", "like", `%${search}%`), eb("code", "like", `%${search}%`)])))
    .executeTakeFirst();
  return num(row?.n);
}

/** Small list of a program's affiliates for filter and form selects (most recent first). */
export async function affiliateOptions(programId: number, limit = 500): Promise<Array<{ id: number; name: string; email: string; code: string; status: string }>> {
  const db = await getDb();
  const rows = await db.selectFrom("affiliates").select(["id", "name", "email", "code", "status"]).where("program_id", "=", programId).orderBy("name").limit(limit).execute();
  // Plain objects: these go to client components (SQLite rows have a null prototype).
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, code: r.code, status: r.status }));
}

// ── Setup checklist & overview cards ──

export interface SetupStatus {
  scriptInstalled: boolean;
  /** A conversion arrived from a webhook or the REST API. */
  serverConnected: boolean;
  hasAffiliate: boolean;
  hasConversion: boolean;
  lastClickAt: string | null;
}

export async function getSetupStatus(program: { id: number; verifiedAt: string | null }): Promise<SetupStatus> {
  const db = await getDb();
  const [server, anyConversion, affiliate, lastClick] = await Promise.all([
    db
      .selectFrom("conversions")
      .select("id")
      .where("program_id", "=", program.id)
      .where("source", "in", ["stripe", "woocommerce", "shopify", "generic", "api"])
      .limit(1)
      .executeTakeFirst(),
    db.selectFrom("conversions").select("id").where("program_id", "=", program.id).limit(1).executeTakeFirst(),
    db.selectFrom("affiliates").select("id").where("program_id", "=", program.id).limit(1).executeTakeFirst(),
    db.selectFrom("clicks").select("ts").where("program_id", "=", program.id).orderBy("ts", "desc").limit(1).executeTakeFirst(),
  ]);
  return {
    scriptInstalled: Boolean(program.verifiedAt || lastClick),
    serverConnected: Boolean(server),
    hasAffiliate: Boolean(affiliate),
    hasConversion: Boolean(anyConversion),
    lastClickAt: lastClick?.ts ?? null,
  };
}

export interface ProgramCardStats {
  affiliates: number;
  pendingAffiliates: number;
  clicks30: number;
  conversions30: number;
  revenue30Cents: number;
  /** Pending + approved commissions not paid yet. */
  owedCents: number;
  paidCents: number;
}

/** Numbers for the program cards of /dashboard. */
export async function getProgramCardStats(programId: number): Promise<ProgramCardStats> {
  const range = periodRange(30);
  const [kpis, affiliates, totals] = await Promise.all([getPeriodKpis(programId, range), countAffiliatesByStatus(programId), getCommissionTotals(programId)]);
  return {
    affiliates: affiliates.all,
    pendingAffiliates: affiliates.pending,
    clicks30: kpis.clicks,
    conversions30: kpis.conversions,
    revenue30Cents: kpis.revenueCents,
    owedCents: totals.pendingCents + totals.approvedCents,
    paidCents: totals.paidCents,
  };
}

/** Recent referrals (leads) of an affiliate. */
export async function listAffiliateReferrals(programId: number, affiliateId: number, limit = 10) {
  const db = await getDb();
  return db
    .selectFrom("referrals")
    .select(["id", "email", "customer_ref", "status", "source", "created_at", "converted_at"])
    .where("program_id", "=", programId)
    .where("affiliate_id", "=", affiliateId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

/** Payouts of one affiliate, newest first. */
export async function listAffiliatePayouts(programId: number, affiliateId: number, limit = 20) {
  const db = await getDb();
  return db
    .selectFrom("payouts")
    .select(["id", "batch_id", "amount_cents", "currency", "method", "status", "reference", "conversion_count", "created_at", "paid_at"])
    .where("program_id", "=", programId)
    .where("affiliate_id", "=", affiliateId)
    .where("status", "!=", "cancelled")
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
}

/** Affiliate id and paid date of payouts (batch page links). */
export async function getPayoutMeta(programId: number, payoutIds: number[]): Promise<Map<number, { affiliate_id: number; paid_at: string | null }>> {
  if (!payoutIds.length) return new Map();
  const db = await getDb();
  const rows = await db.selectFrom("payouts").select(["id", "affiliate_id", "paid_at"]).where("program_id", "=", programId).where("id", "in", payoutIds).execute();
  return new Map(rows.map((r) => [r.id, { affiliate_id: r.affiliate_id, paid_at: r.paid_at }]));
}

/** Referral token of the latest click of an approved affiliate (real test events), or null. */
export async function latestReferralToken(programId: number): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("clicks")
    .innerJoin("affiliates", "affiliates.id", "clicks.affiliate_id")
    .select("clicks.token")
    .where("clicks.program_id", "=", programId)
    .where("affiliates.status", "=", "approved")
    .orderBy("clicks.ts", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.token ?? null;
}
