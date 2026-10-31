import "server-only";
import { sql } from "kysely";
import { after } from "next/server";
import { getDb, now } from "./db";
import type { Click, Conversion, Referral } from "./db/schema";
import { getAffiliate, getAffiliateByCode, type AffiliateRecord } from "./affiliates";
import { monthsBetween, recordConversion, reverseConversion, toConversionRecord, type ConversionRecord } from "./conversions";
import { notifyConversionReversed, notifyNewConversion } from "./notify";
import type { ProgramRecord } from "./programs";
import { hashEmail, randomToken } from "./tokens";
import type { ReferralEvent } from "./webhooks/presets";
import { fromMinorUnits, normalizeEmail, str, withinRecurringLimit } from "@/referral/normalize";
import type { ConversionFlag, ConversionSource } from "@/referral/types";

/**
 * Attribution: turns a referral event (webhook, REST API, rz.js) into a lead or a conversion
 * of the right affiliate, or reverses the conversion of a refunded payment.
 *
 * Order of attribution (last click wins):
 * 1. referral token (rz_ref cookie → client_reference_id / metadata / order meta / API) whose
 *    click (or lead) is inside the program's attribution window (cookieDays)
 * 2. affiliate referral code (REST API, Shopify landing page ?ref=CODE)
 * 3. the subscription / customer of an earlier conversion (renewals: no window, the recurring
 *    rule decides whether they earn)
 * 4. a lead with the same customer id, then with the same email (inside the window unless it
 *    already converted)
 * 5. a coupon code used for the order that the merchant assigned to an affiliate
 *    (case-insensitive)
 * Anything else is ignored with a reason. Only approved affiliates earn.
 */

const DAY_MS = 86_400_000;
const TOKEN_RE = /^[A-Za-z0-9]{16,32}$/;

export type Via = "token" | "code" | "subscription" | "customer" | "email" | "coupon";

export type EventResult =
  | { status: "created"; conversion: ConversionRecord; affiliate: AffiliateRecord; via: Via }
  | { status: "duplicate"; conversion: ConversionRecord }
  /** `adjusted`: the commission was already paid out, so a negative adjustment reduces the next payout. */
  | { status: "reversed"; conversion: ConversionRecord; adjusted?: boolean }
  | { status: "lead"; referral: Referral; affiliate: AffiliateRecord; via: Via; created: boolean }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: "quota" | "invalid"; message: string };

type ProgramLike = Pick<ProgramRecord, "id" | "userId" | "name" | "slug" | "domain" | "currency" | "settings">;

interface Attribution {
  affiliate: AffiliateRecord;
  referral: Referral | null;
  click: Click | null;
  via: Via;
}

/** Run `work` after the response (Next.js after()), or right away outside a request. Never throws. */
export function runAfter(work: () => Promise<unknown>): void {
  const safe = () => work().catch((error: unknown) => console.error("[referzen] background task failed:", error));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

function insideWindow(startIso: string, atIso: string, days: number): boolean {
  const start = Date.parse(startIso);
  const at = Date.parse(atIso);
  if (Number.isNaN(start) || Number.isNaN(at)) return false;
  // A click may be stamped slightly after the payment (clock skew between servers): allow a day.
  return start <= at + DAY_MS && at - start <= days * DAY_MS;
}

export async function findClickByToken(programId: number, token: string): Promise<Click | undefined> {
  if (!TOKEN_RE.test(token)) return undefined;
  const db = await getDb();
  return db.selectFrom("clicks").selectAll().where("token", "=", token).where("program_id", "=", programId).orderBy("id").limit(1).executeTakeFirst();
}

async function findReferral(programId: number, column: "token" | "customer_ref" | "email_hash", value: string): Promise<Referral | undefined> {
  const db = await getDb();
  return db.selectFrom("referrals").selectAll().where("program_id", "=", programId).where(column, "=", value).orderBy("id", "desc").limit(1).executeTakeFirst();
}

/** The affiliate a coupon code was assigned to (case-insensitive), or undefined. */
export async function findAffiliateIdByCoupon(programId: number, code: string): Promise<number | undefined> {
  const value = str(code, "", 60).toLowerCase();
  if (!value) return undefined;
  const db = await getDb();
  const rows = await db
    .selectFrom("affiliates")
    .select(["id", "status"])
    .where("program_id", "=", programId)
    .where("coupon_code", "is not", null)
    .where(sql<string>`lower(coupon_code)`, "=", value)
    .orderBy("id")
    .limit(5)
    .execute();
  // An approved affiliate wins when several share the code.
  return (rows.find((r) => r.status === "approved") ?? rows[0])?.id;
}

interface AttributionInput {
  token?: string;
  affiliateCode?: string;
  subscriptionRef?: string;
  customerRef?: string;
  email?: string;
  couponCodes?: string[];
  /** ISO time of the payment / lead. */
  at: string;
}

async function withAffiliate(affiliateId: number, rest: Omit<Attribution, "affiliate">): Promise<Attribution | { reason: string }> {
  const affiliate = await getAffiliate(affiliateId);
  if (!affiliate) return { reason: "The referring affiliate no longer exists." };
  if (affiliate.status !== "approved") return { reason: `The referring affiliate (${affiliate.code}) is ${affiliate.status}, not approved.` };
  return { affiliate, ...rest };
}

/** Find the affiliate who referred a payment / lead. */
export async function attribute(program: ProgramLike, input: AttributionInput): Promise<Attribution | { reason: string }> {
  const days = program.settings.cookieDays;
  const db = await getDb();

  // 1. Referral token (last click).
  const token = str(input.token, "", 64);
  if (TOKEN_RE.test(token)) {
    const click = (await findClickByToken(program.id, token)) ?? null;
    const referral = (await findReferral(program.id, "token", token)) ?? null;
    const start = click?.ts ?? referral?.created_at;
    if (start && (insideWindow(start, input.at, days) || referral?.status === "converted")) {
      return withAffiliate(click?.affiliate_id ?? referral!.affiliate_id, { referral, click, via: "token" });
    }
  }

  // 2. Affiliate code.
  if (input.affiliateCode) {
    const affiliate = await getAffiliateByCode(program.id, input.affiliateCode);
    if (affiliate) return withAffiliate(affiliate.id, { referral: null, click: null, via: "code" });
  }

  // 3. Subscription / customer of an earlier conversion (renewals).
  for (const [column, value, via] of [
    ["subscription_ref", input.subscriptionRef, "subscription"],
    ["customer_ref", input.customerRef, "customer"],
  ] as const) {
    if (!value) continue;
    const earlier = await db
      .selectFrom("conversions")
      .select(["affiliate_id", "referral_id"])
      .where("program_id", "=", program.id)
      .where(column, "=", value)
      .orderBy("occurred_at")
      .limit(1)
      .executeTakeFirst();
    if (earlier) {
      const referral = earlier.referral_id ? ((await db.selectFrom("referrals").selectAll().where("id", "=", earlier.referral_id).executeTakeFirst()) ?? null) : null;
      return withAffiliate(earlier.affiliate_id, { referral, click: null, via });
    }
  }

  // 4. Leads by customer id, then by email.
  const email = normalizeEmail(input.email);
  for (const [column, value, via] of [
    ["customer_ref", input.customerRef, "customer"],
    ["email_hash", email ? hashEmail(email) : "", "email"],
  ] as const) {
    if (!value) continue;
    const referral = await findReferral(program.id, column, value);
    if (referral && (referral.status === "converted" || insideWindow(referral.created_at, input.at, days))) {
      return withAffiliate(referral.affiliate_id, { referral, click: null, via });
    }
  }

  // 5. Coupon code of an affiliate.
  for (const code of input.couponCodes ?? []) {
    const affiliateId = await findAffiliateIdByCoupon(program.id, code);
    if (affiliateId) return withAffiliate(affiliateId, { referral: null, click: null, via: "coupon" });
  }

  return { reason: "No matching referral: no valid referral token, referral code, earlier conversion of this customer, lead with this email or affiliate coupon." };
}

/** True when the payment is a renewal: the affiliate already earned on this subscription / customer. */
async function isRenewal(program: ProgramLike, affiliateId: number, event: ReferralEvent): Promise<boolean> {
  const db = await getDb();
  for (const [column, value] of [
    ["subscription_ref", event.subscriptionRef],
    ["customer_ref", event.customerRef],
  ] as const) {
    if (!value) continue;
    const row = await db.selectFrom("conversions").select("id").where("program_id", "=", program.id).where("affiliate_id", "=", affiliateId).where(column, "=", value).limit(1).executeTakeFirst();
    if (row) return true;
  }
  return false;
}

/**
 * A new first purchase (not a renewal) of a customer who was already credited to another
 * affiliate of the program: same customer id on a conversion or converted referral, or the same
 * email on a converted referral.
 */
async function creditedToOtherAffiliate(program: ProgramLike, affiliateId: number, event: ReferralEvent, email: string): Promise<boolean> {
  const db = await getDb();
  if (event.customerRef) {
    const conv = await db
      .selectFrom("conversions")
      .select("id")
      .where("program_id", "=", program.id)
      .where("customer_ref", "=", event.customerRef)
      .where("affiliate_id", "!=", affiliateId)
      .where("status", "!=", "reversed")
      .limit(1)
      .executeTakeFirst();
    if (conv) return true;
  }
  const emailHash = email ? hashEmail(email) : "";
  for (const [column, value] of [
    ["customer_ref", event.customerRef ?? ""],
    ["email_hash", emailHash],
  ] as const) {
    if (!value) continue;
    const ref = await db
      .selectFrom("referrals")
      .select("id")
      .where("program_id", "=", program.id)
      .where(column, "=", value)
      .where("affiliate_id", "!=", affiliateId)
      .where("status", "=", "converted")
      .limit(1)
      .executeTakeFirst();
    if (ref) return true;
  }
  return false;
}

/** Trust flags of a conversion (self-referral and duplicate customer checks). */
async function fraudFlags(program: ProgramLike, affiliate: AffiliateRecord, attribution: Attribution, event: ReferralEvent, email: string): Promise<ConversionFlag[]> {
  const flags: ConversionFlag[] = [];
  const affiliateHash = hashEmail(affiliate.email);
  if ((email && hashEmail(email) === affiliateHash) || attribution.referral?.email_hash === affiliateHash) flags.push("self_referral");
  let click = attribution.click;
  if (!click && attribution.referral) click = (await findClickByToken(attribution.referral.program_id, attribution.referral.token)) ?? null;
  if (click && affiliate.lastVisitorHash && click.visitor_hash === affiliate.lastVisitorHash) flags.push("same_visitor");
  if (attribution.via !== "subscription" && !(await isRenewal(program, affiliate.id, event)) && (await creditedToOtherAffiliate(program, affiliate.id, event, email))) {
    flags.push("duplicate_customer");
  }
  return flags;
}

/** Create the lead of an attributed customer, or add the email / customer id to the existing one. */
async function upsertReferral(
  program: ProgramLike,
  attribution: Attribution,
  data: { token?: string; email?: string; customerRef?: string; source: string; at: string },
): Promise<{ referral: Referral; created: boolean }> {
  const db = await getDb();
  const email = normalizeEmail(data.email);
  const emailHash = email ? hashEmail(email) : null;
  const plainEmail = email && program.settings.leadEmailMode === "plain" ? email : null;
  const customerRef = str(data.customerRef, "", 190) || null;
  const existing = attribution.referral && attribution.referral.affiliate_id === attribution.affiliate.id ? attribution.referral : null;
  if (existing) {
    const patch: Partial<Referral> = {};
    if (!existing.email_hash && emailHash) {
      patch.email_hash = emailHash;
      patch.email = plainEmail;
    }
    if (!existing.customer_ref && customerRef) patch.customer_ref = customerRef;
    if (Object.keys(patch).length) {
      await db.updateTable("referrals").set(patch).where("id", "=", existing.id).execute();
      return { referral: { ...existing, ...patch }, created: false };
    }
    return { referral: existing, created: false };
  }
  const token = data.token && TOKEN_RE.test(data.token) ? data.token : attribution.click?.token ?? randomToken(24);
  const values = {
    program_id: program.id,
    affiliate_id: attribution.affiliate.id,
    token,
    email: plainEmail,
    email_hash: emailHash,
    customer_ref: customerRef,
    status: "lead" as const,
    source: data.source.slice(0, 16),
    sub_id: attribution.click?.sub_id ?? "",
    created_at: data.at,
    converted_at: null,
  };
  const result = await db.insertInto("referrals").values(values).executeTakeFirstOrThrow();
  return { referral: { id: Number(result.insertId), ...values }, created: true };
}

/** Process a lead (a referred visitor identified by email / customer id). */
async function processLead(program: ProgramLike, source: ConversionSource, event: ReferralEvent): Promise<EventResult> {
  const at = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : now();
  const email = normalizeEmail(event.email);
  if (!email && !event.customerRef) return { status: "ignored", reason: "A lead needs an email or a customer id." };
  const attribution = await attribute(program, { token: event.referralToken, affiliateCode: event.affiliateCode, at });
  if ("reason" in attribution) return { status: "ignored", reason: attribution.reason };
  const { referral, created } = await upsertReferral(program, attribution, { token: event.referralToken, email, customerRef: event.customerRef, source, at });
  return { status: "lead", referral, affiliate: attribution.affiliate, via: attribution.via, created };
}

/** Earlier conversions decide whether a renewal still earns (the program's recurring rule). */
async function insideRecurringWindow(program: ProgramLike, affiliateId: number, event: ReferralEvent, at: string): Promise<boolean> {
  const ref = event.subscriptionRef || event.customerRef;
  if (!ref) return true;
  const db = await getDb();
  const earlier = await db
    .selectFrom("conversions")
    .select(["occurred_at"])
    .where("program_id", "=", program.id)
    .where("affiliate_id", "=", affiliateId)
    .where(event.subscriptionRef ? "subscription_ref" : "customer_ref", "=", ref)
    .where("occurred_at", "<=", at)
    .orderBy("occurred_at")
    .execute();
  if (!earlier.length) return true;
  return withinRecurringLimit(program.settings.recurring, earlier.length + 1, monthsBetween(earlier[0].occurred_at, at));
}

async function processPayment(program: ProgramLike, source: ConversionSource, event: ReferralEvent, extraFlags: ConversionFlag[]): Promise<EventResult> {
  const externalId = str(event.externalId, "", 190);
  if (!externalId) return { status: "rejected", reason: "invalid", message: "The payment has no order / invoice id." };
  if (!(event.amountCents > 0)) return { status: "ignored", reason: "The payment amount is zero." };
  const db = await getDb();
  const at = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : now();

  const existing = await db.selectFrom("conversions").selectAll().where("program_id", "=", program.id).where("source", "=", source).where("external_id", "=", externalId).executeTakeFirst();
  if (existing) {
    // A later event of the same payment may know its payment intent / charge (refund matching).
    const patch: Partial<Pick<Conversion, "payment_ref" | "charge_ref">> = {};
    if (!existing.payment_ref && event.paymentRef && event.paymentRef !== externalId) patch.payment_ref = str(event.paymentRef, "", 190);
    if (!existing.charge_ref && event.chargeRef) patch.charge_ref = str(event.chargeRef, "", 190);
    if (Object.keys(patch).length) await db.updateTable("conversions").set(patch).where("id", "=", existing.id).execute();
    return { status: "duplicate", conversion: toConversionRecord({ ...existing, ...patch }) };
  }

  // Stripe sends both checkout.session.completed and invoice.paid for the first payment of a subscription.
  if (event.firstOfSubscription && event.subscriptionRef) {
    const first = await db.selectFrom("conversions").selectAll().where("program_id", "=", program.id).where("subscription_ref", "=", event.subscriptionRef).orderBy("id").limit(1).executeTakeFirst();
    if (first) return { status: "duplicate", conversion: toConversionRecord(first) };
  }

  const attribution = await attribute(program, {
    token: event.referralToken,
    affiliateCode: event.affiliateCode,
    subscriptionRef: event.subscriptionRef,
    customerRef: event.customerRef,
    email: event.email,
    couponCodes: event.couponCodes,
    at,
  });
  if ("reason" in attribution) return { status: "ignored", reason: attribution.reason };
  const { affiliate } = attribution;

  if (!(await insideRecurringWindow(program, affiliate.id, event, at))) {
    return { status: "ignored", reason: "Renewal outside the program's recurring commission period: no commission." };
  }

  const email = normalizeEmail(event.email);
  const flags = [...new Set([...extraFlags, ...(await fraudFlags(program, affiliate, attribution, event, email))])];
  const { referral } = await upsertReferral(program, attribution, { token: event.referralToken, email, customerRef: event.customerRef, source, at });

  const result = await recordConversion({
    program: { id: program.id, userId: program.userId, currency: program.currency, settings: program.settings },
    affiliate: { id: affiliate.id, commissionOverride: affiliate.commissionOverride },
    referralId: referral.id,
    source,
    externalId,
    amountCents: event.amountCents,
    currency: event.currency || program.currency,
    customerRef: event.customerRef,
    subscriptionRef: event.subscriptionRef,
    paymentRef: event.paymentRef && event.paymentRef !== externalId ? event.paymentRef : null,
    chargeRef: event.chargeRef,
    occurredAt: at,
    flags,
  });
  if (result.status === "rejected") {
    return {
      status: "rejected",
      reason: result.reason,
      message: result.reason === "quota" ? "The monthly conversion limit of the merchant's plan is reached: the conversion was not recorded." : "Invalid conversion.",
    };
  }
  if (result.status === "duplicate") return { status: "duplicate", conversion: result.conversion };
  const conversion = result.conversion;
  runAfter(() => notifyNewConversion(program, affiliate, conversion));
  return { status: "created", conversion, affiliate, via: attribution.via };
}

/**
 * Sources whose conversions a refund of `source` may reverse: provider refunds only touch the
 * provider's own conversions; refunds from the merchant's server (generic webhook, REST API)
 * may reverse any conversion recorded by the merchant (generic, API, rz.js, manual).
 */
function refundSources(source: ConversionSource): ConversionSource[] {
  switch (source) {
    case "generic":
    case "api":
      return ["generic", "api", "js", "manual"];
    default:
      return [source];
  }
}

async function processRefund(program: ProgramLike, source: ConversionSource, event: ReferralEvent): Promise<EventResult> {
  const db = await getDb();
  const sources = refundSources(source);
  const ids = [...new Set([...(event.relatedIds ?? []), event.externalId].map((id) => str(id, "", 190)).filter(Boolean))];
  let row: Conversion | undefined;
  if (ids.length) {
    // The order / invoice id itself, else another id of the same payment (payment intent, charge).
    const rows = await db
      .selectFrom("conversions")
      .selectAll()
      .where("program_id", "=", program.id)
      .where("source", "in", sources)
      .where((eb) => eb.or([eb("external_id", "in", ids), eb("payment_ref", "in", ids), eb("charge_ref", "in", ids)]))
      .orderBy("id")
      .limit(10)
      .execute();
    row = rows.find((r) => ids.includes(r.external_id)) ?? rows.find((r) => r.payment_ref && ids.includes(r.payment_ref)) ?? rows[0];
  }
  // Last resort (Stripe charges that no longer link to their invoice): the customer's latest
  // payment of the same amount, among conversions whose payment ids are unknown (a conversion
  // with a known payment intent / charge would have matched above).
  if (!row && event.customerRef && event.paymentCents) {
    row = await db
      .selectFrom("conversions")
      .selectAll()
      .where("program_id", "=", program.id)
      .where("source", "in", sources)
      .where("customer_ref", "=", event.customerRef)
      .where("amount_cents", "=", event.paymentCents)
      .where("status", "in", ["pending", "approved"])
      .where("payment_ref", "is", null)
      .where("charge_ref", "is", null)
      .orderBy("occurred_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
  }
  if (!row) return { status: "ignored", reason: "No conversion matches this refund (the payment was not referred)." };
  const conversion = toConversionRecord(row);
  if (conversion.status === "reversed") return { status: "duplicate", conversion };
  const base = event.paymentCents || conversion.amountCents;
  if (event.amountCents > 0 && base > 0 && event.amountCents * 2 < base) {
    return { status: "ignored", reason: `Partial refund (${event.amountCents} of ${base}) below 50% of the payment: the commission is kept.` };
  }
  const reason = str(event.reason, "", 200) || "Refunded";
  const reversedHow = await reverseConversion(conversion.id, reason);
  if (!reversedHow) return { status: "ignored", reason: "The conversion could not be reversed." };
  const reversed: ConversionRecord = { ...conversion, status: "reversed", reversalReason: reason };
  const affiliate = await getAffiliate(conversion.affiliateId);
  if (affiliate) runAfter(() => notifyConversionReversed(program, affiliate, reversed, reason));
  return { status: "reversed", conversion: reversed, adjusted: reversedHow === "reversed_paid" };
}

/**
 * Process one referral event of `program` (webhooks, REST API, rz.js). Payments are recorded
 * idempotently on (program, source, externalId); refunds reverse the matching conversion of the
 * same source; leads create / update the referred customer. Notifications are sent after the response.
 */
export async function processReferralEvent(program: ProgramLike, source: ConversionSource, event: ReferralEvent, options: { flags?: ConversionFlag[] } = {}): Promise<EventResult> {
  switch (event.kind) {
    case "lead":
      return processLead(program, source, event);
    case "refund":
      return processRefund(program, source, event);
    default:
      return processPayment(program, source, event, options.flags ?? []);
  }
}

/** Short JSON summary of a result (webhook responses). Commissions are in the program currency. */
export function describeResult(result: EventResult, programCurrency: string): Record<string, unknown> {
  switch (result.status) {
    case "created":
      return {
        status: "created",
        conversion_id: result.conversion.id,
        affiliate: result.affiliate.code,
        attributed_by: result.via,
        amount_cents: result.conversion.amountCents,
        currency: result.conversion.currency,
        commission_cents: result.conversion.commissionCents,
        ...(result.conversion.currency !== programCurrency ? { commission_currency: programCurrency } : {}),
        nth: result.conversion.nth,
        conversion_status: result.conversion.status,
        ...(result.conversion.flags.length ? { flags: result.conversion.flags } : {}),
      };
    case "duplicate":
      return { status: "duplicate", conversion_id: result.conversion.id, reason: "Already recorded: nothing changed." };
    case "reversed":
      return {
        status: "reversed",
        conversion_id: result.conversion.id,
        reason: result.conversion.reversalReason,
        ...(result.adjusted
          ? { adjustment: { amount: -fromMinorUnits(result.conversion.commissionCents, programCurrency), currency: programCurrency, note: "Already paid out: deducted from the affiliate's next payout." } }
          : {}),
      };
    case "lead":
      return { status: "lead", referral_id: result.referral.id, affiliate: result.affiliate.code, attributed_by: result.via, created: result.created };
    case "ignored":
      return { status: "ignored", reason: result.reason };
    case "rejected":
      return { status: "rejected", reason: result.reason, message: result.message };
  }
}
