/**
 * Incoming webhook presets: detect the sender (Stripe, WooCommerce, Shopify or a generic JSON
 * sender) and turn its payload into referral events (payments, refunds and leads) that
 * src/lib/attribution.ts attributes to affiliates and records as conversions.
 *
 * Pure functions (only the dependency-free src/referral/normalize helpers are imported), so
 * they can be unit-tested in isolation.
 *
 * Authentication: the secret token in the webhook URL (/api/hooks/<token>) identifies and
 * authenticates the program. When the merchant stores signing secrets, every request must carry
 * a valid provider signature (Stripe-Signature, X-WC-Webhook-Signature, X-Shopify-Hmac-Sha256
 * or X-Referzen-Signature), see src/lib/webhooks/verify.ts.
 */

import { normalizeCurrency, normalizeEmail, toMinorUnits } from "@/referral/normalize";

export const WEBHOOK_PRESETS = ["stripe", "woocommerce", "shopify", "generic"] as const;
export type WebhookPreset = (typeof WEBHOOK_PRESETS)[number];

/** Names under which the referral token (rz_ref cookie) is passed in metadata / attributes. */
export const REFERRAL_KEYS = ["referzen", "_referzen", "rz_ref", "referral"];

/**
 * One provider event, normalised. Money in minor units of `currency`.
 * - payment: a paid order / invoice / charge → a conversion (idempotent on externalId)
 * - refund: a refund, cancellation or dispute → the matching conversion is reversed
 * - lead: a referred customer was identified without a payment yet (trial checkout, sign-up)
 */
export interface ReferralEvent {
  kind: "payment" | "refund" | "lead";
  /** payment: order / invoice / payment id (unique per program and source); refund: refund or dispute id. */
  externalId: string;
  /** refund: ids that may identify the refunded payment (order, payment intent, invoice, charge). */
  relatedIds?: string[];
  /** payment: amount paid; refund: amount refunded (0 = the whole payment). */
  amountCents: number;
  /** refund: amount of the original payment when the sender knows it (partial refund check). */
  paymentCents?: number;
  /** ISO 4217 code ("" = the program currency). */
  currency: string;
  /** Customer id in the merchant's system (Stripe "cus_…", WooCommerce / Shopify customer id). */
  customerRef?: string;
  /** Subscription id (Stripe "sub_…"): renewals are counted per subscription. */
  subscriptionRef?: string;
  email?: string;
  /** Referral token from the rz_ref cookie (client_reference_id, metadata, order meta, cart attribute). */
  referralToken?: string;
  /** Affiliate referral code (Shopify landing page ?ref=CODE, REST API). */
  affiliateCode?: string;
  /** Coupon / discount codes used for the order: credit the affiliate the merchant assigned the coupon to. */
  couponCodes?: string[];
  /** payment: another id of the same payment (Stripe payment intent of an invoice), kept so refunds and disputes match. */
  paymentRef?: string;
  /** payment: the charge id (Stripe "ch_…"), when known. */
  chargeRef?: string;
  /** First payment of a new subscription (Stripe billing_reason subscription_create): may repeat the Checkout payment. */
  firstOfSubscription?: boolean;
  /** ISO date of the payment / refund. */
  occurredAt?: string;
  /** Refund / reversal reason shown to the merchant. */
  reason?: string;
}

export type MapResult =
  | { status: "ok"; events: ReferralEvent[] }
  /** Valid request that records nothing (unsupported event type, unpaid order, ping). */
  | { status: "ignored"; reason: string }
  | { status: "error"; error: string };

export interface HeaderReader {
  get(name: string): string | null;
}

/** Program settings the mappers use. */
export interface MapOptions {
  /** Query parameters that carry the referral code (Shopify landing page fallback). */
  refParams?: string[];
}

/** Parameters always checked on a Shopify landing page, after the program's own ones. */
const LANDING_PARAMS = ["ref", "via", "aff", "affiliate"];

/** Most events accepted in one generic request. */
export const MAX_GENERIC_EVENTS = 50;

type Obj = Record<string, unknown>;

const rec = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 190): string =>
  (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "").replace(/[\x00-\x1F\x7F]/g, "").slice(0, max);
const first = (...values: unknown[]): string => {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return "";
};
/** Stripe fields are ids or expanded objects: "cus_123" or { id: "cus_123", … }. */
const idOf = (v: unknown): string => (isObj(v) ? str(v.id) : str(v));
const cents = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);
/** Referral tokens are 16–32 letters / digits; anything else is ignored. */
const token = (v: unknown): string => {
  const s = str(v, 64);
  return /^[A-Za-z0-9]{16,32}$/.test(s) ? s : "";
};
const tokenFromRecord = (o: Obj): string => first(...REFERRAL_KEYS.map((k) => token(o[k])));
/** A coupon code as entered in the shop: printable, no spaces at the ends, at most 60 characters. */
const couponCode = (v: unknown): string => {
  const s = str(v, 60);
  return /^[^\s<>"']{2,60}$/.test(s) ? s : "";
};
/** Coupon codes from a string, a list of strings or a list of objects with `key`. */
function couponList(v: unknown, key = "code"): string[] {
  const items = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const out: string[] = [];
  for (const item of items.slice(0, 20)) {
    const code = couponCode(isObj(item) ? item[key] : item);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Accepts ISO strings, "YYYY-MM-DDTHH:mm:ss" in UTC (WooCommerce *_gmt fields) and Unix seconds. */
function isoDate(v: unknown, assumeUtc = false): string | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = str(v);
  if (!s) return undefined;
  const value = assumeUtc && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s) ? `${s}Z` : s;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Drop empty optional fields. */
function compact(e: ReferralEvent): ReferralEvent {
  const out = { ...e } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length) || v === false) delete out[k];
  }
  out.kind = e.kind;
  out.externalId = e.externalId;
  out.amountCents = e.amountCents;
  out.currency = e.currency;
  if (e.relatedIds) out.relatedIds = [...new Set(e.relatedIds.filter(Boolean))];
  return out as unknown as ReferralEvent;
}

export function isWebhookPreset(v: unknown): v is WebhookPreset {
  return typeof v === "string" && (WEBHOOK_PRESETS as readonly string[]).includes(v);
}

/** Guess the sender from headers and body shape. Falls back to "generic". */
export function detectPreset(body: unknown, headers: HeaderReader): WebhookPreset {
  if (headers.get("x-shopify-topic") || headers.get("x-shopify-shop-domain")) return "shopify";
  if (headers.get("x-wc-webhook-topic") || headers.get("x-wc-webhook-source")) return "woocommerce";
  if (headers.get("stripe-signature")) return "stripe";
  if (!isObj(body)) return "generic";
  if (body.object === "event" && typeof body.type === "string" && isObj(rec(body.data).object)) return "stripe";
  if ("webhook_id" in body && Object.keys(body).length <= 2) return "woocommerce";
  if ("order_id" in body && Array.isArray(body.refund_line_items)) return "shopify";
  if (Array.isArray(body.line_items)) {
    if (str(body.admin_graphql_api_id).startsWith("gid://shopify/") || "order_number" in body || "total_price" in body) return "shopify";
    if (isObj(body.billing) || "order_key" in body) return "woocommerce";
  }
  return "generic";
}

// ---------------------------------------------------------------- Stripe

function stripeCurrency(v: unknown): string {
  return normalizeCurrency(v, "");
}

/**
 * Coupon codes of a Stripe Checkout Session / invoice: metadata.coupon, or the code of a
 * promotion code that Stripe sent expanded (discounts[].promotion_code.code). Plain ids
 * ("promo_…", coupon ids) can't be matched to a code without an API call and are skipped.
 */
function stripeCoupons(obj: Obj, metadata: Obj): string[] {
  const out = couponList(metadata.coupon);
  const breakdown = rec(rec(obj.total_details).breakdown).discounts;
  const discounts = [
    ...(Array.isArray(obj.discounts) ? obj.discounts : []),
    ...(isObj(obj.discount) ? [obj.discount] : []),
    ...(Array.isArray(breakdown) ? breakdown.map((b) => rec(b).discount) : []),
  ];
  for (const d of discounts) {
    const promo = isObj(d) ? d.promotion_code : undefined;
    if (!isObj(promo)) continue;
    for (const code of couponList(promo.code)) if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** Payment intent and charge of a paid invoice (older API versions: fields; newer: invoice.payments). */
function invoicePaymentRefs(obj: Obj): { paymentRef: string; chargeRef: string } {
  let paymentRef = idOf(obj.payment_intent);
  let chargeRef = idOf(obj.charge);
  const payments = rec(obj.payments).data;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      const payment = rec(rec(p).payment);
      paymentRef ||= idOf(payment.payment_intent);
      chargeRef ||= idOf(payment.charge);
    }
  }
  return { paymentRef, chargeRef };
}

/** Ids that may identify the payment of a charge: the charge, its payment intent and (when expanded or on older API versions) the invoice. */
function chargeRelatedIds(charge: unknown): string[] {
  const c = rec(charge);
  const pi = c.payment_intent;
  return [idOf(charge), idOf(pi), idOf(c.invoice), idOf(rec(pi).invoice)];
}

function mapStripe(body: unknown): MapResult {
  if (!isObj(body) || body.object !== "event" || typeof body.type !== "string") {
    return { status: "error", error: "This is not a Stripe event. Send Stripe webhook events (JSON) to this URL." };
  }
  const obj = rec(rec(body.data).object);
  const metadata = rec(obj.metadata);
  const eventTime = isoDate(body.created) ?? isoDate(obj.created);
  const type = body.type;

  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const details = rec(obj.customer_details);
      const referralToken = first(token(obj.client_reference_id), tokenFromRecord(metadata));
      const subscriptionRef = idOf(obj.subscription);
      const base = {
        currency: stripeCurrency(obj.currency),
        customerRef: idOf(obj.customer),
        subscriptionRef,
        email: normalizeEmail(first(details.email, obj.customer_email)),
        referralToken,
        couponCodes: stripeCoupons(obj, metadata),
        occurredAt: eventTime,
      };
      const amount = cents(obj.amount_total);
      const paid = obj.payment_status === "paid" || type === "checkout.session.async_payment_succeeded";
      if (!paid || amount === 0) {
        // Free trial or delayed payment method: remember the referred customer; the invoice / async event pays later.
        if (!referralToken && !base.email) return { status: "ignored", reason: "Checkout completed without a payment and without a referral." };
        return { status: "ok", events: [compact({ kind: "lead", externalId: str(obj.id), amountCents: 0, ...base })] };
      }
      return {
        status: "ok",
        events: [
          compact({
            kind: "payment",
            // The invoice id for subscriptions (so invoice.paid for the same invoice is a duplicate), else the payment intent.
            externalId: first(idOf(obj.invoice), idOf(obj.payment_intent), obj.id),
            paymentRef: idOf(obj.invoice) ? idOf(obj.payment_intent) : "",
            amountCents: amount,
            firstOfSubscription: obj.mode === "subscription" || Boolean(subscriptionRef),
            ...base,
          }),
        ],
      };
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const amount = cents(obj.amount_paid);
      if (!amount) return { status: "ignored", reason: "Invoice paid with a zero amount (trial, credit or 100% discount)." };
      const parent = rec(obj.parent);
      const parentSub = rec(parent.subscription_details);
      const subDetails = rec(obj.subscription_details);
      const lines = rec(obj.lines).data;
      const lineMeta = Array.isArray(lines) && lines.length ? rec(rec(lines[0]).metadata) : {};
      const { paymentRef, chargeRef } = invoicePaymentRefs(obj);
      return {
        status: "ok",
        events: [
          compact({
            kind: "payment",
            externalId: str(obj.id),
            // Refunds and disputes arrive for the charge / payment intent, not the invoice.
            paymentRef,
            chargeRef,
            amountCents: amount,
            currency: stripeCurrency(obj.currency),
            customerRef: idOf(obj.customer),
            subscriptionRef: first(idOf(obj.subscription), idOf(parentSub.subscription)),
            email: normalizeEmail(obj.customer_email),
            referralToken: first(tokenFromRecord(metadata), tokenFromRecord(rec(subDetails.metadata)), tokenFromRecord(rec(parentSub.metadata)), tokenFromRecord(lineMeta)),
            couponCodes: stripeCoupons(obj, { ...rec(parentSub.metadata), ...rec(subDetails.metadata), ...metadata }),
            firstOfSubscription: obj.billing_reason === "subscription_create",
            occurredAt: isoDate(rec(obj.status_transitions).paid_at) ?? eventTime,
          }),
        ],
      };
    }
    case "charge.succeeded":
    case "payment_intent.succeeded": {
      if (idOf(obj.invoice)) return { status: "ignored", reason: "Subscription payment: recorded from the invoice.paid event." };
      const referralToken = tokenFromRecord(metadata);
      if (!referralToken) {
        return { status: "ignored", reason: `No referral token in the metadata ("referzen") of this ${type === "charge.succeeded" ? "charge" : "payment"}; Checkout and invoices are tracked by their own events.` };
      }
      const billing = rec(obj.billing_details);
      const isCharge = type === "charge.succeeded";
      return {
        status: "ok",
        events: [
          compact({
            kind: "payment",
            externalId: isCharge ? first(idOf(obj.payment_intent), obj.id) : str(obj.id),
            chargeRef: isCharge ? str(obj.id) : idOf(obj.latest_charge),
            amountCents: isCharge ? cents(obj.amount_captured) || cents(obj.amount) : cents(obj.amount_received) || cents(obj.amount),
            currency: stripeCurrency(obj.currency),
            customerRef: idOf(obj.customer),
            email: normalizeEmail(first(billing.email, obj.receipt_email)),
            referralToken,
            couponCodes: couponList(metadata.coupon),
            occurredAt: eventTime,
          }),
        ],
      };
    }
    case "charge.refunded": {
      return {
        status: "ok",
        events: [
          compact({
            kind: "refund",
            externalId: str(obj.id),
            relatedIds: [...chargeRelatedIds(obj), idOf(obj.invoice)],
            amountCents: cents(obj.amount_refunded),
            paymentCents: cents(obj.amount_captured) || cents(obj.amount),
            currency: stripeCurrency(obj.currency),
            customerRef: idOf(obj.customer),
            occurredAt: eventTime,
            reason: obj.refunded === true ? "Refunded in Stripe" : "Partially refunded in Stripe",
          }),
        ],
      };
    }
    case "refund.created":
    case "refund.updated":
    case "charge.refund.updated": {
      // A Refund object: the charge.refunded event usually arrives too (then this one is a duplicate).
      const status = str(obj.status);
      if (status && status !== "succeeded") return { status: "ignored", reason: `Refund status "${status.slice(0, 30)}": only succeeded refunds reverse a commission.` };
      return {
        status: "ok",
        events: [
          compact({
            kind: "refund",
            externalId: str(obj.id),
            relatedIds: [...chargeRelatedIds(obj.charge), idOf(obj.payment_intent), idOf(rec(obj.payment_intent).invoice)],
            amountCents: cents(obj.amount),
            paymentCents: cents(rec(obj.charge).amount_captured) || cents(rec(obj.charge).amount),
            currency: stripeCurrency(obj.currency),
            customerRef: idOf(rec(obj.charge).customer),
            occurredAt: eventTime,
            reason: "Refunded in Stripe",
          }),
        ],
      };
    }
    case "charge.dispute.created": {
      return {
        status: "ok",
        events: [
          compact({
            kind: "refund",
            externalId: str(obj.id),
            // The charge (or its payment intent / invoice when Stripe sends them expanded).
            relatedIds: [...chargeRelatedIds(obj.charge), idOf(obj.payment_intent), idOf(rec(obj.payment_intent).invoice)],
            amountCents: 0,
            currency: stripeCurrency(obj.currency),
            customerRef: idOf(rec(obj.charge).customer),
            paymentCents: cents(rec(obj.charge).amount_captured) || cents(rec(obj.charge).amount) || cents(obj.amount),
            occurredAt: eventTime,
            reason: `Payment disputed in Stripe${str(obj.reason) ? ` (${str(obj.reason, 60)})` : ""}`,
          }),
        ],
      };
    }
    default:
      return { status: "ignored", reason: `Stripe event "${type.slice(0, 80)}" is not used for referrals.` };
  }
}

// ---------------------------------------------------------------- WooCommerce

const WOO_PAID = new Set(["processing", "completed"]);
const WOO_REVERSED = new Set(["refunded", "cancelled"]);

function wooMeta(body: Obj): Obj {
  const out: Obj = {};
  if (Array.isArray(body.meta_data)) {
    for (const m of body.meta_data) {
      const key = str(rec(m).key, 60);
      if (key) out[key] = rec(m).value;
    }
  }
  return out;
}

function mapWooCommerce(body: unknown, headers: HeaderReader): MapResult {
  if (!isObj(body)) return { status: "error", error: "Expected a WooCommerce order (JSON)." };
  // WooCommerce sends `webhook_id=<id>` once when the webhook is saved.
  if ("webhook_id" in body && !isObj(body.billing)) return { status: "ignored", reason: "WooCommerce ping received. The webhook is connected." };
  const topic = (headers.get("x-wc-webhook-topic") ?? "").toLowerCase();
  if (topic && !topic.startsWith("order.")) return { status: "ignored", reason: `WooCommerce topic "${topic.slice(0, 60)}" is not used for referrals (send order webhooks).` };
  if (!isObj(body.billing) || !str(body.id)) return { status: "error", error: "Expected a WooCommerce order with an id and billing details." };
  if (topic === "order.deleted") return { status: "ignored", reason: "Deleted orders are not used." };

  const status = str(body.status);
  const orderId = str(body.id);
  const currency = normalizeCurrency(body.currency, "");
  const total = toMinorUnits(body.total, currency || "USD");
  const meta = wooMeta(body);
  const customerId = str(body.customer_id);
  const occurredAt = isoDate(body.date_paid_gmt, true) ?? isoDate(body.date_created_gmt, true) ?? isoDate(body.date_created);
  let refunded = 0;
  if (Array.isArray(body.refunds)) {
    for (const r of body.refunds) refunded += toMinorUnits(str(rec(r).total).replace("-", ""), currency || "USD");
  }

  if (WOO_REVERSED.has(status) || (WOO_PAID.has(status) && refunded > 0 && refunded * 2 >= total)) {
    return {
      status: "ok",
      events: [
        compact({
          kind: "refund",
          externalId: orderId,
          relatedIds: [orderId],
          amountCents: status === "cancelled" || status === "refunded" ? 0 : refunded,
          paymentCents: total,
          currency,
          occurredAt: isoDate(body.date_modified_gmt, true) ?? occurredAt,
          reason: status === "cancelled" ? "Order cancelled in WooCommerce" : "Order refunded in WooCommerce",
        }),
      ],
    };
  }
  if (!WOO_PAID.has(status)) {
    return { status: "ignored", reason: `Order status "${status.slice(0, 40) || "unknown"}" is not paid yet (processing or completed orders are recorded).` };
  }
  return {
    status: "ok",
    events: [
      compact({
        kind: "payment",
        externalId: orderId,
        amountCents: total,
        currency,
        customerRef: customerId && customerId !== "0" ? customerId : undefined,
        email: normalizeEmail(rec(body.billing).email),
        // Saved in the order meta (_referzen) by the snippet on the Integrations page.
        referralToken: tokenFromRecord(meta),
        couponCodes: couponList(body.coupon_lines),
        occurredAt,
      }),
    ],
  };
}

// ---------------------------------------------------------------- Shopify

function shopifyAttributes(body: Obj): Obj {
  const out: Obj = {};
  for (const list of [body.note_attributes, body.attributes]) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const name = str(rec(a).name ?? rec(a).key, 60);
      if (name) out[name] = rec(a).value;
    }
  }
  return out;
}

/** ?ref=CODE on the order's landing page: the program's referral parameters, then ref / via / aff / affiliate. */
function landingCode(landing: string, refParams: string[] = []): string {
  if (!landing) return "";
  try {
    const url = new URL(landing, "https://shop.invalid");
    for (const p of [...new Set([...refParams, ...LANDING_PARAMS])]) {
      const v = url.searchParams.get(p);
      if (v) return str(v, 40);
    }
  } catch {
    // not a URL
  }
  return "";
}

function mapShopify(body: unknown, headers: HeaderReader, options: MapOptions): MapResult {
  const topic = (headers.get("x-shopify-topic") ?? "").toLowerCase();
  if (!isObj(body)) return { status: "error", error: "Expected a Shopify order or refund (JSON)." };

  // refunds/create
  if (topic === "refunds/create" || (!topic && "order_id" in body && Array.isArray(body.refund_line_items))) {
    const orderId = str(body.order_id);
    if (!orderId) return { status: "error", error: "Expected a Shopify refund with an order_id." };
    let refunded = 0;
    let currency = "";
    if (Array.isArray(body.transactions)) {
      for (const t of body.transactions) {
        const tr = rec(t);
        if (str(tr.kind) === "refund" && (str(tr.status) === "success" || !tr.status)) {
          currency ||= normalizeCurrency(tr.currency, "");
          refunded += toMinorUnits(tr.amount, currency || "USD");
        }
      }
    }
    return {
      status: "ok",
      events: [compact({ kind: "refund", externalId: str(body.id), relatedIds: [orderId], amountCents: refunded, currency, occurredAt: isoDate(body.created_at), reason: "Refunded in Shopify" })],
    };
  }

  if (topic && !["orders/paid", "orders/create", "orders/cancelled", "orders/updated"].includes(topic)) {
    return { status: "ignored", reason: `Shopify topic "${topic.slice(0, 60)}" is not used for referrals (send orders/paid and refunds/create).` };
  }
  if (!str(body.id) || !("total_price" in body || Array.isArray(body.line_items))) return { status: "error", error: "Expected a Shopify order (JSON)." };

  const orderId = str(body.id);
  const currency = normalizeCurrency(body.currency, "");
  const total = toMinorUnits(body.total_price, currency || "USD");
  const financial = str(body.financial_status);
  if (topic === "orders/cancelled" || financial === "refunded" || financial === "voided") {
    return {
      status: "ok",
      events: [
        compact({
          kind: "refund",
          externalId: orderId,
          relatedIds: [orderId],
          amountCents: 0,
          currency,
          occurredAt: isoDate(body.cancelled_at) ?? isoDate(body.updated_at),
          reason: topic === "orders/cancelled" ? "Order cancelled in Shopify" : "Order refunded in Shopify",
        }),
      ],
    };
  }
  if (topic !== "orders/paid" && financial !== "paid" && financial !== "partially_refunded") {
    return { status: "ignored", reason: `Order is not paid yet (financial status "${financial.slice(0, 30) || "unknown"}").` };
  }
  const customer = rec(body.customer);
  const attributes = shopifyAttributes(body);
  return {
    status: "ok",
    events: [
      compact({
        kind: "payment",
        externalId: orderId,
        amountCents: total,
        currency,
        customerRef: idOf(customer.id),
        email: normalizeEmail(first(body.email, body.contact_email, customer.email)),
        referralToken: tokenFromRecord(attributes),
        affiliateCode: landingCode(str(body.landing_site, 1000), options.refParams),
        couponCodes: couponList(body.discount_codes),
        occurredAt: isoDate(body.processed_at) ?? isoDate(body.created_at),
      }),
    ],
  };
}

// ---------------------------------------------------------------- Generic

function genericKind(v: unknown): ReferralEvent["kind"] | "" {
  const s = str(v).toLowerCase();
  if (["payment", "sale", "order", "purchase", "charge", "renewal", "invoice"].includes(s)) return "payment";
  if (["refund", "reversal", "chargeback", "cancel", "cancellation", "dispute"].includes(s)) return "refund";
  if (["lead", "signup", "sign_up", "registration", "trial"].includes(s)) return "lead";
  return s ? "" : "payment";
}

function mapGenericItem(o: Obj): ReferralEvent | string {
  const kind = genericKind(o.event ?? o.type ?? o.kind);
  if (!kind) return `Unknown event "${str(o.event ?? o.type ?? o.kind, 40)}" (use payment, refund or lead).`;
  const id = first(o.id, o.order_id, o.orderId, o.invoice_id);
  const currency = normalizeCurrency(o.currency, "");
  if (kind !== "lead" && !id) return "Each payment or refund needs an \"id\" (your order / invoice id).";
  const amountCents = toMinorUnits(o.amount, currency || "USD");
  if (kind === "payment" && !amountCents) return "Each payment needs a positive \"amount\" (major units, e.g. 49.90).";
  const email = normalizeEmail(o.email);
  const customer = first(o.customer, o.customer_id, o.customerId);
  const referral = first(token(o.referral), token(o.referzen), token(o.token));
  const code = first(o.affiliate, o.affiliate_code, o.ref);
  if (kind === "lead" && !referral && !code) return "A lead needs a \"referral\" token or an \"affiliate\" code.";
  if (kind === "lead" && !email && !customer) return "A lead needs an \"email\" or a \"customer\" id.";
  return compact({
    kind,
    externalId: id,
    relatedIds: kind === "refund" ? [id] : undefined,
    amountCents: kind === "lead" ? 0 : amountCents,
    currency,
    customerRef: customer,
    subscriptionRef: first(o.subscription, o.subscription_id),
    email,
    referralToken: referral,
    affiliateCode: code,
    couponCodes: kind === "payment" ? [...new Set([...couponList(o.coupon), ...couponList(o.coupon_code), ...couponList(o.coupons)])] : undefined,
    occurredAt: isoDate(o.occurred_at) ?? isoDate(o.created_at) ?? isoDate(o.date),
    reason: kind === "refund" ? str(o.reason, 200) || "Refunded" : undefined,
  });
}

function mapGeneric(body: unknown): MapResult {
  const list: unknown[] | null = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.events) ? body.events : isObj(body) ? [body] : null;
  if (!list) return { status: "error", error: "Send a JSON object, an array of objects, or { \"events\": [...] }." };
  if (list.length > MAX_GENERIC_EVENTS) return { status: "error", error: `Send at most ${MAX_GENERIC_EVENTS} events per request.` };
  const items = list.filter(isObj);
  if (!items.length) return { status: "error", error: "No events found in the request body." };
  const events: ReferralEvent[] = [];
  for (const item of items) {
    const mapped = mapGenericItem(item);
    if (typeof mapped === "string") return { status: "error", error: mapped };
    events.push(mapped);
  }
  return { status: "ok", events };
}

/** Map a parsed request body to referral events using `preset`. */
export function mapWebhook(preset: WebhookPreset, body: unknown, headers: HeaderReader, options: MapOptions = {}): MapResult {
  switch (preset) {
    case "stripe":
      return mapStripe(body);
    case "woocommerce":
      return mapWooCommerce(body, headers);
    case "shopify":
      return mapShopify(body, headers, options);
    default:
      return mapGeneric(body);
  }
}
