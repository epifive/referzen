import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import { getAffiliateEarnings } from "./payouts";
import { getClickStats } from "./portal-stats";
import { isPayoutMethod } from "@/referral/normalize";
import type { ConversionStatus, PayoutMethod, ProgramSettings } from "@/referral/types";

/**
 * Read models of the affiliate portal. Every query is scoped to (program_id, affiliate_id)
 * of the signed-in affiliate. Customer emails are never returned unmasked.
 */

export const PORTAL_RANGES = [30, 90] as const;
export type PortalRange = (typeof PORTAL_RANGES)[number];

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "jane.doe@mail.com" → "j•••@m•••.com" */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "";
  const [user, domain] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${user.slice(0, 1)}•••@${domain.slice(0, 1)}•••${tld}`;
}

export interface DayPoint {
  day: string;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  commissionCents: number;
}

export interface PortalOverview {
  range: PortalRange;
  fromDay: string;
  toDay: string;
  clicks: number;
  uniqueClicks: number;
  referrals: number;
  conversions: number;
  /** conversions / unique clicks (0–1), null without clicks. */
  conversionRate: number | null;
  /** Commission earned in the range (not reversed). */
  rangeCommissionCents: number;
  days: DayPoint[];
  earnings: { pendingCents: number; approvedCents: number; paidCents: number; reversedCents: number; adjustmentCents: number };
  /** Approved and not in a payout yet, minus adjustments not deducted yet: what the next payout would contain. */
  dueCents: number;
  /** Approved commissions already in a payout that hasn't been paid yet. */
  processingCents: number;
  minPayoutCents: number;
}

export async function getPortalOverview(
  program: { id: number; settings: Pick<ProgramSettings, "minPayoutCents"> },
  affiliateId: number,
  range: PortalRange,
): Promise<PortalOverview> {
  const db = await getDb();
  const nowMs = Date.now();
  const toDay = utcDay(nowMs);
  const fromDay = utcDay(nowMs - (range - 1) * DAY_MS);
  const fromIso = `${fromDay}T00:00:00.000Z`;
  const day = sql<string>`substr(occurred_at, 1, 10)`;

  const [clickStats, referrals, convRows, earnings, due, processing] = await Promise.all([
    getClickStats({ programId: program.id, affiliateId, fromDay, toDay }),
    db
      .selectFrom("referrals")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("program_id", "=", program.id)
      .where("affiliate_id", "=", affiliateId)
      .where("created_at", ">=", fromIso)
      .executeTakeFirst(),
    db
      .selectFrom("conversions")
      .select([day.as("day"), (eb) => eb.fn.countAll<number>().as("n"), (eb) => eb.fn.sum<number>("commission_cents").as("commission")])
      .where("program_id", "=", program.id)
      .where("affiliate_id", "=", affiliateId)
      .where("status", "!=", "reversed")
      .where("occurred_at", ">=", fromIso)
      .groupBy(day)
      .execute(),
    getAffiliateEarnings(program.id, affiliateId),
    db
      .selectFrom("conversions")
      .select((eb) => eb.fn.sum<number>("commission_cents").as("total"))
      .where("program_id", "=", program.id)
      .where("affiliate_id", "=", affiliateId)
      .where("status", "=", "approved")
      .where("payout_id", "is", null)
      .executeTakeFirst(),
    db
      .selectFrom("conversions")
      .select((eb) => eb.fn.sum<number>("commission_cents").as("total"))
      .where("program_id", "=", program.id)
      .where("affiliate_id", "=", affiliateId)
      .where("status", "=", "approved")
      .where("payout_id", "is not", null)
      .executeTakeFirst(),
  ]);

  const convByDay = new Map(convRows.map((r) => [r.day, { n: Number(r.n ?? 0), commission: Number(r.commission ?? 0) }]));
  const days: DayPoint[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = utcDay(nowMs - i * DAY_MS);
    const c = clickStats.byDay.get(d);
    const v = convByDay.get(d);
    days.push({ day: d, clicks: c?.clicks ?? 0, uniqueClicks: c?.uniqueClicks ?? 0, conversions: v?.n ?? 0, commissionCents: v?.commission ?? 0 });
  }
  const conversions = days.reduce((s, d) => s + d.conversions, 0);
  return {
    range,
    fromDay,
    toDay,
    clicks: clickStats.clicks,
    uniqueClicks: clickStats.uniqueClicks,
    referrals: Number(referrals?.n ?? 0),
    conversions,
    conversionRate: clickStats.uniqueClicks > 0 ? conversions / clickStats.uniqueClicks : null,
    rangeCommissionCents: days.reduce((s, d) => s + d.commissionCents, 0),
    days,
    earnings,
    dueCents: Number(due?.total ?? 0) + earnings.adjustmentCents,
    processingCents: Number(processing?.total ?? 0),
    minPayoutCents: program.settings.minPayoutCents,
  };
}

export interface PortalConversion {
  id: number;
  occurredAt: string;
  amountCents: number;
  commissionCents: number;
  currency: string;
  status: ConversionStatus;
  /** 2+ = subscription renewal. */
  nth: number;
  /** Masked customer email ("j•••@g•••.com") or "". */
  customer: string;
  approvedAt: string | null;
  paidAt: string | null;
}

export async function getPortalConversions(programId: number, affiliateId: number, options: { limit?: number; offset?: number; status?: ConversionStatus } = {}): Promise<{ rows: PortalConversion[]; total: number }> {
  const db = await getDb();
  const base = db
    .selectFrom("conversions")
    .where("conversions.program_id", "=", programId)
    .where("conversions.affiliate_id", "=", affiliateId)
    .$if(options.status !== undefined, (qb) => qb.where("conversions.status", "=", options.status!));
  const [total, rows] = await Promise.all([
    base.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    base
      .leftJoin("referrals", (join) => join.onRef("referrals.id", "=", "conversions.referral_id").onRef("referrals.program_id", "=", "conversions.program_id"))
      .select([
        "conversions.id",
        "conversions.occurred_at",
        "conversions.amount_cents",
        "conversions.commission_cents",
        "conversions.currency",
        "conversions.status",
        "conversions.nth",
        "conversions.approved_at",
        "conversions.paid_at",
        "referrals.email as customer_email",
      ])
      .orderBy("conversions.occurred_at", "desc")
      .orderBy("conversions.id", "desc")
      .limit(Math.min(Math.max(options.limit ?? 20, 1), 100))
      .offset(Math.max(options.offset ?? 0, 0))
      .execute(),
  ]);
  return {
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      amountCents: Number(r.amount_cents),
      commissionCents: Number(r.commission_cents),
      currency: r.currency,
      status: (["pending", "approved", "paid", "reversed"].includes(r.status) ? r.status : "pending") as ConversionStatus,
      nth: Number(r.nth),
      customer: maskEmail(r.customer_email),
      approvedAt: r.approved_at,
      paidAt: r.paid_at,
    })),
  };
}

export interface PortalPayout {
  id: number;
  amountCents: number;
  currency: string;
  method: PayoutMethod;
  status: "draft" | "paid";
  reference: string | null;
  conversionCount: number;
  createdAt: string;
  paidAt: string | null;
}

/** The affiliate's payouts (cancelled ones are hidden). */
export async function getPortalPayouts(programId: number, affiliateId: number, limit = 50): Promise<PortalPayout[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("payouts")
    .select(["id", "amount_cents", "currency", "method", "status", "reference", "conversion_count", "created_at", "paid_at"])
    .where("program_id", "=", programId)
    .where("affiliate_id", "=", affiliateId)
    .where("status", "!=", "cancelled")
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    method: isPayoutMethod(r.method) ? r.method : "other",
    status: r.status === "paid" ? "paid" : "draft",
    reference: r.reference,
    conversionCount: Number(r.conversion_count),
    createdAt: r.created_at,
    paidAt: r.paid_at,
  }));
}
