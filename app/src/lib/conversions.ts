import "server-only";
import { getDb, now } from "./db";
import type { Conversion } from "./db/schema";
import { getEntitlementsForUserId } from "./plans";
import { hasConversionQuota, incrementUsage } from "./usage";
import { computeCommission, isConversionSource, isConversionStatus, normalizeCurrency, parseFlags, serializeFlags, str } from "@/referral/normalize";
import { HELD_FLAGS, type CommissionOverride, type ConversionFlag, type ConversionSource, type ConversionStatus, type ProgramSettings } from "@/referral/types";

export interface ConversionRecord {
  id: number;
  programId: number;
  affiliateId: number;
  referralId: number | null;
  source: ConversionSource;
  externalId: string;
  customerRef: string | null;
  subscriptionRef: string | null;
  /** Other id of the payment (Stripe payment intent) used to match refunds and disputes. */
  paymentRef: string | null;
  /** Charge id of the payment (Stripe "ch_…"). */
  chargeRef: string | null;
  nth: number;
  /** Order amount in minor units of `currency`. */
  amountCents: number;
  currency: string;
  /** Commission in minor units of the program currency (may differ from `currency`, see currency_mismatch). */
  commissionCents: number;
  status: ConversionStatus;
  flags: ConversionFlag[];
  payoutId: number | null;
  occurredAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  note: string | null;
  createdAt: string;
}

export function toConversionRecord(row: Conversion): ConversionRecord {
  return {
    id: row.id,
    programId: row.program_id,
    affiliateId: row.affiliate_id,
    referralId: row.referral_id,
    source: isConversionSource(row.source) ? row.source : "manual",
    externalId: row.external_id,
    customerRef: row.customer_ref,
    subscriptionRef: row.subscription_ref,
    paymentRef: row.payment_ref ?? null,
    chargeRef: row.charge_ref ?? null,
    nth: Number(row.nth),
    // MySQL returns BIGINT/DECIMAL values as strings in some configurations.
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    commissionCents: Number(row.commission_cents),
    status: isConversionStatus(row.status) ? row.status : "pending",
    flags: parseFlags(row.flags),
    payoutId: row.payout_id,
    occurredAt: row.occurred_at,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** True when a conversion carries a flag that keeps it pending until the merchant reviews it. */
export function hasHeldFlag(flags: readonly ConversionFlag[]): boolean {
  return flags.some((f) => HELD_FLAGS.includes(f));
}

/** A conversion of `programId` (check the program with getOwnedProgram() first). */
export async function getOwnedConversion(programId: number, conversionId: number): Promise<ConversionRecord | undefined> {
  if (!Number.isInteger(conversionId) || conversionId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("conversions").selectAll().where("id", "=", conversionId).where("program_id", "=", programId).executeTakeFirst();
  return row ? toConversionRecord(row) : undefined;
}

export async function getConversionByExternalId(programId: number, source: ConversionSource, externalId: string): Promise<ConversionRecord | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom("conversions")
    .selectAll()
    .where("program_id", "=", programId)
    .where("source", "=", source)
    .where("external_id", "=", externalId)
    .executeTakeFirst();
  return row ? toConversionRecord(row) : undefined;
}

/** Whole calendar months from `fromIso` to `toIso` (0 within the first month). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export interface RecordConversionInput {
  program: { id: number; userId: number; currency: string; settings: Pick<ProgramSettings, "commissionType" | "rate" | "recurring" | "holdDays"> };
  affiliate: { id: number; commissionOverride: CommissionOverride | null };
  referralId?: number | null;
  source: ConversionSource;
  /** Order / invoice / charge id; (program, source, externalId) is unique, so repeats are no-ops. */
  externalId: string;
  amountCents: number;
  /** Default: the program currency. */
  currency?: string;
  /** Customer id in the merchant's system: later payments of the same customer count as renewals. */
  customerRef?: string | null;
  /** Subscription id: renewals are counted per subscription when given. */
  subscriptionRef?: string | null;
  /** Other ids of the same payment (payment intent, charge) so refunds and disputes match it. */
  paymentRef?: string | null;
  chargeRef?: string | null;
  /**
   * Payment number for the recurring limit (1 = first). Default: 1 + earlier conversions of the
   * same subscription (or customer); the months since the first one are used in "months" mode.
   */
  nth?: number;
  occurredAt?: string;
  flags?: ConversionFlag[];
  note?: string | null;
  /**
   * Default: "approved" when the program's hold is 0 days and no review flag is set, else
   * "pending". Flagged conversions (HELD_FLAGS) always start pending.
   */
  status?: "pending" | "approved";
  /** Record even when the owner's monthly conversion quota is used up (manual conversions). */
  skipQuota?: boolean;
  /** Commission override in minor units of the program currency (manual conversions); default computeCommission(). */
  commissionCents?: number;
}

export type RecordConversionResult =
  | { status: "created"; conversion: ConversionRecord }
  /** The same (program, source, externalId) was recorded before: nothing changed. */
  | { status: "duplicate"; conversion: ConversionRecord }
  | { status: "rejected"; reason: "quota" | "invalid" };

/**
 * Record a conversion idempotently and compute its commission. Updates the referral (lead →
 * converted) and the owner's monthly usage. Notifications are the caller's job.
 *
 * Commissions are always in the program currency. A payment in another currency is flagged
 * "currency_mismatch" and stays pending: a percentage of it can't be computed without an
 * exchange rate, so its commission is 0 until the merchant sets it when approving (a fixed
 * commission per sale is already in the program currency and is kept).
 */
export async function recordConversion(input: RecordConversionInput): Promise<RecordConversionResult> {
  const externalId = str(input.externalId, "", 190);
  if (!externalId) return { status: "rejected", reason: "invalid" };
  const existing = await getConversionByExternalId(input.program.id, input.source, externalId);
  if (existing) return { status: "duplicate", conversion: existing };

  if (!input.skipQuota) {
    const entitlements = await getEntitlementsForUserId(input.program.userId);
    if (!(await hasConversionQuota(input.program.userId, entitlements))) return { status: "rejected", reason: "quota" };
  }

  const db = await getDb();
  const ts = now();
  const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : ts;
  const subscriptionRef = str(input.subscriptionRef, "", 190) || null;
  const customerRef = str(input.customerRef, "", 190) || null;
  const programCurrency = normalizeCurrency(input.program.currency);
  const currency = normalizeCurrency(input.currency, programCurrency);

  let nth = input.nth && input.nth >= 1 ? Math.floor(input.nth) : 1;
  let monthsSinceFirst: number | undefined;
  if (!input.nth && (subscriptionRef || customerRef)) {
    const earlier = await db
      .selectFrom("conversions")
      .select(["occurred_at"])
      .where("program_id", "=", input.program.id)
      .where("affiliate_id", "=", input.affiliate.id)
      .where(subscriptionRef ? "subscription_ref" : "customer_ref", "=", (subscriptionRef ?? customerRef)!)
      .where("occurred_at", "<=", occurredAt)
      .orderBy("occurred_at")
      .execute();
    if (earlier.length) {
      nth = earlier.length + 1;
      monthsSinceFirst = monthsBetween(earlier[0].occurred_at, occurredAt);
    }
  }

  const flags = [...new Set(input.flags ?? [])];
  const amountCents = Math.max(0, Math.round(input.amountCents || 0));
  let commissionCents: number;
  if (input.commissionCents !== undefined) {
    commissionCents = Math.max(0, Math.round(input.commissionCents));
  } else {
    commissionCents = computeCommission({ settings: input.program.settings, affiliateOverride: input.affiliate.commissionOverride, amountCents, nth, monthsSinceFirst });
    if (currency !== programCurrency) {
      flags.push("currency_mismatch");
      const type = input.affiliate.commissionOverride?.commissionType ?? input.program.settings.commissionType;
      if (type === "percent") commissionCents = 0;
    }
  }
  const held = hasHeldFlag(flags);
  const status: ConversionStatus = held ? "pending" : (input.status ?? (input.program.settings.holdDays === 0 ? "approved" : "pending"));

  try {
    const result = await db
      .insertInto("conversions")
      .values({
        program_id: input.program.id,
        affiliate_id: input.affiliate.id,
        referral_id: input.referralId ?? null,
        source: input.source,
        external_id: externalId,
        customer_ref: customerRef,
        subscription_ref: subscriptionRef,
        payment_ref: str(input.paymentRef, "", 190) || null,
        charge_ref: str(input.chargeRef, "", 190) || null,
        nth,
        amount_cents: amountCents,
        currency,
        commission_cents: commissionCents,
        status,
        flags: serializeFlags(flags),
        payout_id: null,
        occurred_at: occurredAt,
        approved_at: status === "approved" ? ts : null,
        paid_at: null,
        reversed_at: null,
        reversal_reason: null,
        note: input.note ? input.note.slice(0, 500) : null,
        created_at: ts,
        updated_at: ts,
      })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);
    if (input.referralId) {
      await db.updateTable("referrals").set({ status: "converted", converted_at: occurredAt }).where("id", "=", input.referralId).where("status", "=", "lead").execute();
    }
    await incrementUsage(input.program.userId, { conversions: 1 });
    const row = await db.selectFrom("conversions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    return { status: "created", conversion: toConversionRecord(row) };
  } catch (error) {
    // A concurrent delivery of the same webhook won the unique (program, source, external_id) race.
    const again = await getConversionByExternalId(input.program.id, input.source, externalId);
    if (again) return { status: "duplicate", conversion: again };
    throw error;
  }
}

export type ReverseResult =
  /** The commission no longer counts. */
  | "reversed"
  /** It was already paid out: reversed, and a negative adjustment is deducted from the next payout. */
  | "reversed_paid"
  /** Already reversed, or not found. */
  | false;

/**
 * Reverse a conversion (refund, dispute, fraud): its commission no longer counts. A conversion
 * in a draft payout is taken out of it. A conversion that was already paid out is reversed too,
 * and its commission is recorded as a negative adjustment that reduces the affiliate's next
 * payout. Already reversed conversions are left alone.
 */
export async function reverseConversion(conversionId: number, reason: string): Promise<ReverseResult> {
  const db = await getDb();
  const row = await db.selectFrom("conversions").selectAll().where("id", "=", conversionId).executeTakeFirst();
  if (!row || row.status === "reversed") return false;
  const ts = now();
  const why = str(reason, "", 255) || null;
  if (row.status === "paid") {
    const program = await db.selectFrom("programs").select("currency").where("id", "=", row.program_id).executeTakeFirst();
    let done = false;
    await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable("conversions")
        .set({ status: "reversed", reversed_at: ts, reversal_reason: why, updated_at: ts })
        .where("id", "=", conversionId)
        .where("status", "=", "paid")
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) return;
      done = true;
      const commission = Number(row.commission_cents);
      if (commission > 0) {
        await trx
          .insertInto("adjustments")
          .values({
            program_id: row.program_id,
            affiliate_id: row.affiliate_id,
            conversion_id: row.id,
            amount_cents: -commission,
            currency: program?.currency ?? row.currency,
            reason: why ? `${why} (order ${row.external_id})`.slice(0, 255) : `Reversed after payout (order ${row.external_id})`.slice(0, 255),
            payout_id: null,
            created_at: ts,
          })
          .execute();
      }
    });
    return done ? "reversed_paid" : false;
  }
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("conversions")
      .set({ status: "reversed", reversed_at: ts, reversal_reason: why, payout_id: null, updated_at: ts })
      .where("id", "=", conversionId)
      .execute();
    if (row.payout_id) {
      const payout = await trx.selectFrom("payouts").select(["id", "batch_id", "status"]).where("id", "=", row.payout_id).executeTakeFirst();
      if (payout?.status === "draft") {
        await trx
          .updateTable("payouts")
          .set((eb) => ({ amount_cents: eb("amount_cents", "-", Number(row.commission_cents)), conversion_count: eb("conversion_count", "-", 1) }))
          .where("id", "=", payout.id)
          .execute();
        if (payout.batch_id) {
          await trx.updateTable("payout_batches").set((eb) => ({ total_cents: eb("total_cents", "-", Number(row.commission_cents)) })).where("id", "=", payout.batch_id).execute();
        }
      }
    }
  });
  return "reversed";
}

/**
 * Approve a pending conversion now, before the refund window ends (the merchant's review):
 * it is payable right away. `commissionCents` (program currency) replaces the commission, e.g.
 * for a payment in another currency.
 */
export async function approveConversion(conversionId: number, commissionCents?: number): Promise<boolean> {
  const db = await getDb();
  const ts = now();
  const res = await db
    .updateTable("conversions")
    .set({ status: "approved", approved_at: ts, updated_at: ts, ...(commissionCents !== undefined ? { commission_cents: Math.max(0, Math.round(commissionCents)) } : {}) })
    .where("id", "=", conversionId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/** Put a reversed or approved (unpaid) conversion back to pending. */
export async function reopenConversion(conversionId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("conversions")
    .set({ status: "pending", approved_at: null, reversed_at: null, reversal_reason: null, updated_at: now() })
    .where("id", "=", conversionId)
    .where("status", "in", ["reversed", "approved"])
    .where("payout_id", "is", null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}
