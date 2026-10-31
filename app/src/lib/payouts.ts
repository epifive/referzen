import "server-only";
import { getDb, now } from "./db";
import type { Payout, PayoutBatch } from "./db/schema";
import { isPayoutMethod, normalizePayoutDetails, parseJson, str } from "@/referral/normalize";
import type { PayoutCsvRow } from "@/referral/csv";
import type { PayoutDetails, PayoutMethod, PayoutStatus, ProgramSettings } from "@/referral/types";

export { buildBankCsv, buildPayPalPayoutsCsv, buildPayoutsCsv } from "@/referral/csv";
export type { PayoutCsvRow } from "@/referral/csv";

/**
 * Payouts: approved commissions are grouped per affiliate into a payout; payouts created
 * together form a batch. Commissions are approved automatically once the program's refund
 * window (hold) has passed, or right away when the merchant approves them by hand: approved
 * means payable. Negative adjustments (a commission reversed after it was paid out) are
 * deducted from the affiliate's next payout. A payout is "draft" until the merchant marks it
 * paid (its conversions then become "paid"); cancelling a draft releases its conversions and
 * adjustments.
 */

export interface DueBalance {
  affiliateId: number;
  name: string;
  email: string;
  code: string;
  method: PayoutMethod;
  details: PayoutDetails;
  /** Net amount: approved commissions plus adjustments (adjustmentCents ≤ 0). */
  amountCents: number;
  /** Unapplied adjustments included in amountCents (0 or negative). */
  adjustmentCents: number;
  conversionCount: number;
  /** False when the balance is below the program minimum (shown, but not paid yet). */
  meetsMinimum: boolean;
  /** False when the affiliate hasn't entered the details their payout method needs. */
  hasPayoutDetails: boolean;
}

export interface PayoutRecord {
  id: number;
  programId: number;
  affiliateId: number;
  batchId: number | null;
  amountCents: number;
  currency: string;
  method: PayoutMethod;
  details: PayoutDetails;
  status: PayoutStatus;
  reference: string | null;
  conversionCount: number;
  /** Adjustments deducted from this payout (0 or negative); amountCents is already net. */
  adjustmentCents: number;
  createdAt: string;
  paidAt: string | null;
}

export interface BatchRecord {
  id: number;
  programId: number;
  status: "draft" | "paid";
  currency: string;
  totalCents: number;
  payoutCount: number;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
}

export function toPayoutRecord(row: Payout): PayoutRecord {
  const method: PayoutMethod = isPayoutMethod(row.method) ? row.method : "other";
  return {
    id: row.id,
    programId: row.program_id,
    affiliateId: row.affiliate_id,
    batchId: row.batch_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    method,
    details: normalizePayoutDetails(method, parseJson(row.details)),
    status: row.status === "paid" || row.status === "cancelled" ? row.status : "draft",
    reference: row.reference,
    conversionCount: Number(row.conversion_count),
    adjustmentCents: Number(row.adjustment_cents ?? 0),
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

export function toBatchRecord(row: PayoutBatch): BatchRecord {
  return {
    id: row.id,
    programId: row.program_id,
    status: row.status === "paid" ? "paid" : "draft",
    currency: row.currency,
    totalCents: Number(row.total_cents),
    payoutCount: Number(row.payout_count),
    note: row.note,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

function hasDetails(method: PayoutMethod, d: PayoutDetails): boolean {
  if (method === "paypal") return Boolean(d.paypalEmail);
  if (method === "bank") return Boolean(d.accountNumber && (d.accountName || d.bankName));
  return Boolean(d.note);
}

/** Unapplied adjustments per affiliate (sum, usually negative). */
async function pendingAdjustments(programId: number, affiliateIds?: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db
    .selectFrom("adjustments")
    .select((eb) => ["affiliate_id", eb.fn.sum<number>("amount_cents").as("total")])
    .where("program_id", "=", programId)
    .where("payout_id", "is", null)
    .$if(affiliateIds !== undefined, (qb) => qb.where("affiliate_id", "in", affiliateIds!.length ? affiliateIds! : [0]))
    .groupBy("affiliate_id")
    .execute();
  return new Map(rows.map((r) => [r.affiliate_id, Number(r.total ?? 0)]));
}

/**
 * Balances owed per affiliate: approved commissions that are not in a payout yet (approval
 * already waited for the refund window, or the merchant approved them by hand), minus the
 * adjustments not deducted yet. Includes balances below the minimum (meetsMinimum = false) so
 * the dashboard can show them; blocked affiliates are left out. Sorted by amount, largest first.
 */
export async function getDueBalances(program: { id: number; settings: Pick<ProgramSettings, "minPayoutCents"> }): Promise<DueBalance[]> {
  const db = await getDb();
  const [sums, adjustments] = await Promise.all([
    db
      .selectFrom("conversions")
      .select((eb) => ["affiliate_id", eb.fn.sum<number>("commission_cents").as("total"), eb.fn.countAll<number>().as("n")])
      .where("program_id", "=", program.id)
      .where("status", "=", "approved")
      .where("payout_id", "is", null)
      .where("commission_cents", ">", 0)
      .groupBy("affiliate_id")
      .execute(),
    pendingAdjustments(program.id),
  ]);
  const ids = [...new Set([...sums.map((s) => s.affiliate_id), ...adjustments.keys()])];
  if (!ids.length) return [];
  const affiliates = await db
    .selectFrom("affiliates")
    .select(["id", "name", "email", "code", "status", "payout_method", "payout_details"])
    .where("program_id", "=", program.id)
    .where("id", "in", ids)
    .execute();
  const byId = new Map(affiliates.map((a) => [a.id, a]));
  const sumBy = new Map(sums.map((s) => [s.affiliate_id, { total: Number(s.total ?? 0), n: Number(s.n ?? 0) }]));
  const out: DueBalance[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a || a.status === "blocked") continue;
    const method: PayoutMethod = isPayoutMethod(a.payout_method) ? a.payout_method : "paypal";
    const details = normalizePayoutDetails(method, parseJson(a.payout_details));
    const commission = sumBy.get(id) ?? { total: 0, n: 0 };
    const adjustmentCents = adjustments.get(id) ?? 0;
    const amountCents = commission.total + adjustmentCents;
    out.push({
      affiliateId: a.id,
      name: a.name,
      email: a.email,
      code: a.code,
      method,
      details,
      amountCents,
      adjustmentCents,
      conversionCount: commission.n,
      meetsMinimum: amountCents > 0 && amountCents >= program.settings.minPayoutCents,
      hasPayoutDetails: hasDetails(method, details),
    });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

/**
 * Create a draft batch with one payout per affiliate whose due balance meets the minimum.
 * `affiliateIds` limits the batch to those affiliates. Returns the batch id, or null when
 * nothing was due.
 */
export async function createPayoutBatch(
  program: { id: number; currency: string; settings: Pick<ProgramSettings, "minPayoutCents"> },
  options: { affiliateIds?: number[]; note?: string } = {},
): Promise<number | null> {
  const wanted = options.affiliateIds ? new Set(options.affiliateIds) : null;
  const due = (await getDueBalances(program)).filter((d) => d.meetsMinimum && d.amountCents > 0 && d.conversionCount > 0 && (!wanted || wanted.has(d.affiliateId)));
  if (!due.length) return null;
  const db = await getDb();
  const ts = now();
  return db.transaction().execute(async (trx) => {
    const batch = await trx
      .insertInto("payout_batches")
      .values({ program_id: program.id, status: "draft", currency: program.currency, total_cents: 0, payout_count: 0, note: str(options.note, "", 500) || null, created_at: ts, paid_at: null })
      .executeTakeFirstOrThrow();
    const batchId = Number(batch.insertId);
    let total = 0;
    let count = 0;
    for (const d of due) {
      const payout = await trx
        .insertInto("payouts")
        .values({
          program_id: program.id,
          affiliate_id: d.affiliateId,
          batch_id: batchId,
          amount_cents: 0,
          currency: program.currency,
          method: d.method,
          details: JSON.stringify(d.details),
          status: "draft",
          reference: null,
          conversion_count: 0,
          created_at: ts,
          paid_at: null,
        })
        .executeTakeFirstOrThrow();
      const payoutId = Number(payout.insertId);
      // Claim the payable conversions (re-checked inside the transaction).
      await trx
        .updateTable("conversions")
        .set({ payout_id: payoutId, updated_at: ts })
        .where("program_id", "=", program.id)
        .where("affiliate_id", "=", d.affiliateId)
        .where("status", "=", "approved")
        .where("payout_id", "is", null)
        .where("commission_cents", ">", 0)
        .execute();
      // Deduct the adjustments that are not applied yet (reversals after an earlier payout).
      await trx
        .updateTable("adjustments")
        .set({ payout_id: payoutId })
        .where("program_id", "=", program.id)
        .where("affiliate_id", "=", d.affiliateId)
        .where("payout_id", "is", null)
        .execute();
      const [sum, adj] = await Promise.all([
        trx
          .selectFrom("conversions")
          .select((eb) => [eb.fn.sum<number>("commission_cents").as("total"), eb.fn.countAll<number>().as("n")])
          .where("payout_id", "=", payoutId)
          .executeTakeFirst(),
        trx.selectFrom("adjustments").select((eb) => eb.fn.sum<number>("amount_cents").as("total")).where("payout_id", "=", payoutId).executeTakeFirst(),
      ]);
      const adjustment = Number(adj?.total ?? 0);
      const amount = Number(sum?.total ?? 0) + adjustment;
      const n = Number(sum?.n ?? 0);
      if (n === 0 || amount <= 0) {
        // Nothing left to pay (the balance changed meanwhile): release everything again.
        await trx.updateTable("conversions").set({ payout_id: null }).where("payout_id", "=", payoutId).execute();
        await trx.updateTable("adjustments").set({ payout_id: null }).where("payout_id", "=", payoutId).execute();
        await trx.deleteFrom("payouts").where("id", "=", payoutId).execute();
        continue;
      }
      await trx.updateTable("payouts").set({ amount_cents: amount, conversion_count: n, adjustment_cents: adjustment }).where("id", "=", payoutId).execute();
      total += amount;
      count += 1;
    }
    if (!count) {
      await trx.deleteFrom("payout_batches").where("id", "=", batchId).execute();
      return null;
    }
    await trx.updateTable("payout_batches").set({ total_cents: total, payout_count: count }).where("id", "=", batchId).execute();
    return batchId;
  });
}

async function refreshBatch(batchId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.selectFrom("payouts").select(["status", "amount_cents"]).where("batch_id", "=", batchId).execute();
  const live = rows.filter((r) => r.status !== "cancelled");
  const allPaid = live.length > 0 && live.every((r) => r.status === "paid");
  await db
    .updateTable("payout_batches")
    .set({
      total_cents: live.reduce((sum, r) => sum + Number(r.amount_cents), 0),
      payout_count: live.length,
      ...(allPaid ? { status: "paid" as const, paid_at: now() } : {}),
    })
    .where("id", "=", batchId)
    .execute();
}

/** Mark one draft payout paid (with an optional payment reference); its conversions become "paid". */
export async function markPayoutPaid(payoutId: number, reference?: string | null): Promise<PayoutRecord | undefined> {
  const db = await getDb();
  const ts = now();
  const updated = await db
    .updateTable("payouts")
    .set({ status: "paid", paid_at: ts, reference: str(reference, "", 190) || null })
    .where("id", "=", payoutId)
    .where("status", "=", "draft")
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) return undefined;
  await db.updateTable("conversions").set({ status: "paid", paid_at: ts, updated_at: ts }).where("payout_id", "=", payoutId).where("status", "=", "approved").execute();
  const row = await db.selectFrom("payouts").selectAll().where("id", "=", payoutId).executeTakeFirstOrThrow();
  if (row.batch_id) await refreshBatch(row.batch_id);
  return toPayoutRecord(row);
}

/** Mark every draft payout of a batch paid. Returns the payouts that were paid now (for emails). */
export async function markBatchPaid(batchId: number, reference?: string | null): Promise<PayoutRecord[]> {
  const db = await getDb();
  const drafts = await db.selectFrom("payouts").select("id").where("batch_id", "=", batchId).where("status", "=", "draft").execute();
  const paid: PayoutRecord[] = [];
  for (const d of drafts) {
    const p = await markPayoutPaid(d.id, reference);
    if (p) paid.push(p);
  }
  await refreshBatch(batchId);
  return paid;
}

/** Cancel a draft payout: its conversions are released and show up as due again. */
export async function cancelPayout(payoutId: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.selectFrom("payouts").select(["id", "batch_id", "status"]).where("id", "=", payoutId).executeTakeFirst();
  if (!row || row.status !== "draft") return false;
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("conversions").set({ payout_id: null, updated_at: now() }).where("payout_id", "=", payoutId).execute();
    await trx.updateTable("adjustments").set({ payout_id: null }).where("payout_id", "=", payoutId).execute();
    await trx.updateTable("payouts").set({ status: "cancelled" }).where("id", "=", payoutId).execute();
  });
  if (row.batch_id) {
    await refreshBatch(row.batch_id);
    // A batch whose payouts were all cancelled is removed.
    const left = await db.selectFrom("payouts").select("id").where("batch_id", "=", row.batch_id).where("status", "!=", "cancelled").executeTakeFirst();
    if (!left) {
      await db.updateTable("payouts").set({ batch_id: null }).where("batch_id", "=", row.batch_id).execute();
      await db.deleteFrom("payout_batches").where("id", "=", row.batch_id).execute();
    }
  }
  return true;
}

export async function getOwnedBatch(programId: number, batchId: number): Promise<BatchRecord | undefined> {
  if (!Number.isInteger(batchId) || batchId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("payout_batches").selectAll().where("id", "=", batchId).where("program_id", "=", programId).executeTakeFirst();
  return row ? toBatchRecord(row) : undefined;
}

export async function getOwnedPayout(programId: number, payoutId: number): Promise<PayoutRecord | undefined> {
  if (!Number.isInteger(payoutId) || payoutId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("payouts").selectAll().where("id", "=", payoutId).where("program_id", "=", programId).executeTakeFirst();
  return row ? toPayoutRecord(row) : undefined;
}

export async function getProgramBatches(programId: number, limit = 50): Promise<BatchRecord[]> {
  const db = await getDb();
  return (await db.selectFrom("payout_batches").selectAll().where("program_id", "=", programId).orderBy("id", "desc").limit(limit).execute()).map(toBatchRecord);
}

/** Payouts of a batch with the affiliate's name and email, ready for the CSV builders. */
export async function getBatchCsvRows(batchId: number, options: { includeCancelled?: boolean } = {}): Promise<PayoutCsvRow[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("payouts")
    .innerJoin("affiliates", "affiliates.id", "payouts.affiliate_id")
    .selectAll("payouts")
    .select(["affiliates.name as affiliate_name", "affiliates.email as affiliate_email"])
    .where("payouts.batch_id", "=", batchId)
    .$if(!options.includeCancelled, (qb) => qb.where("payouts.status", "!=", "cancelled"))
    .orderBy("payouts.id")
    .execute();
  return rows.map((r) => {
    const p = toPayoutRecord(r);
    return {
      payoutId: p.id,
      affiliateName: r.affiliate_name,
      affiliateEmail: r.affiliate_email,
      method: p.method,
      details: p.details,
      amountCents: p.amountCents,
      adjustmentCents: p.adjustmentCents,
      currency: p.currency,
      conversionCount: p.conversionCount,
      reference: p.reference,
      status: p.status,
    };
  });
}

export interface AdjustmentRecord {
  id: number;
  conversionId: number | null;
  amountCents: number;
  currency: string;
  reason: string | null;
  /** Payout it was deducted from (null = deducted from the next payout). */
  payoutId: number | null;
  createdAt: string;
}

/** An affiliate's balance adjustments, newest first (portal earnings, merchant affiliate page). */
export async function getAffiliateAdjustments(programId: number, affiliateId: number, limit = 50): Promise<AdjustmentRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("adjustments")
    .selectAll()
    .where("program_id", "=", programId)
    .where("affiliate_id", "=", affiliateId)
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    conversionId: r.conversion_id,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    reason: r.reason,
    payoutId: r.payout_id,
    createdAt: r.created_at,
  }));
}

/**
 * An affiliate's earnings by status (portal and merchant affiliate page). `paidCents` is what
 * was actually paid out (paid payouts, net of adjustments), so a commission reversed after its
 * payout doesn't make the paid total shrink. `adjustmentCents` is the sum of the adjustments not
 * deducted from a payout yet (0 or negative).
 */
export async function getAffiliateEarnings(
  programId: number,
  affiliateId: number,
): Promise<{ pendingCents: number; approvedCents: number; paidCents: number; reversedCents: number; adjustmentCents: number }> {
  const db = await getDb();
  const [rows, paid, adjustments] = await Promise.all([
    db
      .selectFrom("conversions")
      .select((eb) => ["status", eb.fn.sum<number>("commission_cents").as("total")])
      .where("program_id", "=", programId)
      .where("affiliate_id", "=", affiliateId)
      .groupBy("status")
      .execute(),
    db
      .selectFrom("payouts")
      .select((eb) => eb.fn.sum<number>("amount_cents").as("total"))
      .where("program_id", "=", programId)
      .where("affiliate_id", "=", affiliateId)
      .where("status", "=", "paid")
      .executeTakeFirst(),
    pendingAdjustments(programId, [affiliateId]),
  ]);
  const get = (s: string) => Number(rows.find((r) => r.status === s)?.total ?? 0);
  return {
    pendingCents: get("pending"),
    approvedCents: get("approved"),
    paidCents: Number(paid?.total ?? 0),
    reversedCents: get("reversed"),
    adjustmentCents: adjustments.get(affiliateId) ?? 0,
  };
}
