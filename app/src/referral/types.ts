/**
 * The Referzen contract: shared by the tracker (src/tracker → public/rz.js), the ingest
 * routes (/api/click, /api/referral, /api/hooks/[token], /api/v1/*), the merchant dashboard,
 * the affiliate portal (/a/[slug]), the background jobs and the alert channels.
 *
 * Keep this file free of imports and runtime dependencies: it is used on the server,
 * in client components and (types only) in the tracker.
 *
 * Money is always an integer amount in the currency's minor unit ("cents"; for zero-decimal
 * currencies such as JPY the unit itself, see currencyDecimals() in ./normalize.ts).
 * Commission rates: percent → basis points (2500 = 25 %), fixed → minor units per conversion.
 * Single-tier referral commissions only: an affiliate earns on the customers they referred.
 */

// ── Programs ──

export const COMMISSION_TYPES = ["percent", "fixed"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

/**
 * Recurring payments (subscription renewals):
 * - "none": only the first payment of a customer earns a commission
 * - "months": payments during the first `months` months (or the first `months` payments) earn
 * - "lifetime": every payment earns
 */
export const RECURRING_MODES = ["none", "months", "lifetime"] as const;
export type RecurringMode = (typeof RECURRING_MODES)[number];

export const PAYOUT_METHODS = ["paypal", "bank", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** How customer emails of leads (referrals) are stored. */
export const LEAD_EMAIL_MODES = ["plain", "hashed"] as const;
export type LeadEmailMode = (typeof LEAD_EMAIL_MODES)[number];

/** Program events the merchant can be notified about (also AlertEvent). */
export const NOTIFY_EVENTS = ["new_affiliate", "new_conversion", "conversion_reversed", "payout_paid"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface RecurringRule {
  mode: RecurringMode;
  /** Used when mode = "months" (1–120). */
  months: number;
}

/** Stored as JSON in programs.settings; always read through normalizeProgramSettings(). */
export interface ProgramSettings {
  commissionType: CommissionType;
  /** percent: basis points (2500 = 25 %, max 10000); fixed: minor units per conversion. */
  rate: number;
  recurring: RecurringRule;
  /** Attribution window: days the referral cookie lasts after a click (1–365). */
  cookieDays: number;
  /** Refund window: days a conversion stays "pending" before it is approved (0–365). */
  holdDays: number;
  /** Smallest balance (minor units) paid out; smaller balances roll over. */
  minPayoutCents: number;
  /** Payout methods affiliates can choose (at least one). */
  payoutMethods: PayoutMethod[];
  /** New affiliates are approved at sign-up (otherwise "pending" until the merchant approves). */
  autoApprove: boolean;
  /** Program terms shown in the portal and accepted at sign-up (plain text / Markdown). */
  terms: string;
  /** Portal headline and introduction ("" = generated from the commission). */
  portalHeadline: string;
  portalIntro: string;
  /** Portal brand colour (#rrggbb) and logo URL ("" = platform defaults). */
  brandColor: string;
  logo: string;
  /** Query parameters that carry the referral code, in order of priority (default ["ref", "via"]). */
  refParams: string[];
  /** Extra hostnames allowed to send clicks/referrals (staging, checkout domain…). */
  extraDomains: string[];
  /** Count clicks from localhost (testing). */
  allowLocalhost: boolean;
  leadEmailMode: LeadEmailMode;
  /** Accept client-side conversions from rz.js (window.referzen.convert); flagged lower trust. */
  allowClientConversions: boolean;
  /** Alert channels (alert_channels ids of the owner) notified about `notifyEvents`. */
  alertChannelIds: number[];
  notifyEvents: NotifyEvent[];
  /** Email the affiliate when a conversion is recorded / a payout is paid. */
  emailAffiliates: boolean;
}

export const DEFAULT_PROGRAM_SETTINGS: ProgramSettings = {
  commissionType: "percent",
  rate: 2000,
  recurring: { mode: "none", months: 12 },
  cookieDays: 60,
  holdDays: 30,
  minPayoutCents: 5000,
  payoutMethods: ["paypal"],
  autoApprove: true,
  terms: "",
  portalHeadline: "",
  portalIntro: "",
  brandColor: "",
  logo: "",
  refParams: ["ref", "via"],
  extraDomains: [],
  allowLocalhost: false,
  leadEmailMode: "plain",
  allowClientConversions: false,
  alertChannelIds: [],
  notifyEvents: ["new_affiliate", "new_conversion"],
  emailAffiliates: true,
};

export const PROGRAM_STATUSES = ["active", "paused"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

// ── Affiliates ──

export const AFFILIATE_STATUSES = ["pending", "approved", "blocked"] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

/** Per-affiliate commission (affiliates.commission_override JSON); unset fields use the program's. */
export interface CommissionOverride {
  commissionType?: CommissionType;
  rate?: number;
}

/** affiliates.payout_details JSON. Only the fields of the chosen method are kept. */
export interface PayoutDetails {
  /** PayPal: the receiver's PayPal email. */
  paypalEmail?: string;
  /** Bank: account holder, IBAN / account number, BIC / routing, bank name, country. */
  accountName?: string;
  accountNumber?: string;
  bankCode?: string;
  bankName?: string;
  country?: string;
  /** Other: free text (Wise email, crypto address, …). */
  note?: string;
}

// ── Referrals, conversions, payouts ──

export const REFERRAL_STATUSES = ["lead", "converted"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** pending → approved (after the hold) → paid; reversed (refund / dispute / manual) at any time before paid. */
export const CONVERSION_STATUSES = ["pending", "approved", "paid", "reversed"] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

/** Where a conversion came from. "js" = rz.js client-side (lower trust). */
export const CONVERSION_SOURCES = ["stripe", "woocommerce", "shopify", "generic", "api", "js", "manual"] as const;
export type ConversionSource = (typeof CONVERSION_SOURCES)[number];

/**
 * Fraud / trust flags stored on conversions.flags (comma-separated).
 * - currency_mismatch: paid in another currency than the program's; the commission (in the
 *   program currency) is set by the merchant when approving it.
 */
export const CONVERSION_FLAGS = ["self_referral", "client_side", "same_visitor", "duplicate_customer", "currency_mismatch"] as const;
export type ConversionFlag = (typeof CONVERSION_FLAGS)[number];

/**
 * Flags that keep a conversion "pending" until the merchant reviews it, whatever the hold
 * period (also 0 days). "client_side" is lower trust but approved normally.
 */
export const HELD_FLAGS: readonly ConversionFlag[] = ["self_referral", "same_visitor", "duplicate_customer", "currency_mismatch"];

export const PAYOUT_STATUSES = ["draft", "paid", "cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_BATCH_STATUSES = ["draft", "paid"] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

export const ASSET_TYPES = ["link", "banner", "text", "email"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

// ── Tracker → server (text/plain JSON, small) ──

/** rz.js → POST /api/click when the page URL carries a referral code. */
export interface ClickPayload {
  /** Program public key (data-program attribute of the snippet). */
  k: string;
  /** Referral code from the URL (?ref=CODE). */
  c: string;
  /** Full page URL (location.href, max 1000 chars). */
  u: string;
  /** document.referrer ("" when none). */
  r: string;
  /** Campaign / sub id (?sub=…), optional. */
  s?: string;
}

/** POST /api/click response: what rz.js stores in the first-party cookie + localStorage. */
export interface ClickResponse {
  /** Referral token (identifies the click/visitor for later leads and conversions). */
  t: string;
  /** Referral code of the affiliate. */
  c: string;
  /** Cookie lifetime in days (the program's attribution window). */
  d: number;
}

/** window.referzen.signup({ email, customerId }) → POST /api/referral (a lead). */
export interface ReferralPayload {
  k: string;
  /** Referral token from the cookie. */
  t: string;
  /** Customer email. */
  e?: string;
  /** Customer id in the merchant's system (e.g. Stripe customer id "cus_…"). */
  i?: string;
}

/** window.referzen.convert({ amount, currency, orderId, email }) → POST /api/convert (client-side, flagged). */
export interface ConvertPayload {
  k: string;
  t: string;
  /** Amount in major units (19.99). */
  a: number;
  /** ISO 4217 currency ("USD"); default: the program currency. */
  cur?: string;
  /** Order id (unique per program; makes the call idempotent). */
  o: string;
  e?: string;
}

/** Name of the first-party cookie / localStorage key set by rz.js, and of the hidden form input it fills. */
export const REF_COOKIE = "rz_ref";
export const REF_INPUT_NAME = "referzen";

// ── REST API (/api/v1, API key) ──

export interface ApiConversionInput {
  /** Program the conversion belongs to (must be owned by the API key's account). */
  program_id: number;
  /** Order / invoice id in your system (unique per program; repeating it is a no-op). */
  order_id: string;
  /** Amount in major units (19.99). */
  amount: number;
  currency?: string;
  /** Attribution, in order of priority: referral token, affiliate code, customer id, email, coupon. */
  referral?: string;
  affiliate_code?: string;
  customer_id?: string;
  email?: string;
  /** Subscription id: later payments of the same subscription count as renewals (recurring limit). */
  subscription_id?: string;
  /** Coupon code used at checkout: credits the affiliate the merchant assigned it to. */
  coupon?: string;
  /** ISO date; default now. */
  occurred_at?: string;
}

/** GET /api/v1/programs */
export interface ApiProgram {
  id: number;
  name: string;
  slug: string;
  currency: string;
  status: ProgramStatus;
  portal_url: string;
}

export interface ApiReferralInput {
  program_id: number;
  referral?: string;
  affiliate_code?: string;
  email?: string;
  customer_id?: string;
}

export interface ApiConversion {
  id: number;
  program_id: number;
  affiliate_id: number;
  affiliate_code: string;
  source: ConversionSource;
  order_id: string;
  amount: number;
  commission: number;
  currency: string;
  status: ConversionStatus;
  occurred_at: string;
}

export interface ApiAffiliate {
  id: number;
  program_id: number;
  name: string;
  email: string;
  code: string;
  status: AffiliateStatus;
  created_at: string;
}

// ── Alert channels (same senders as the sibling products) ──

export const CHANNEL_TYPES = ["email", "webhook", "slack", "discord", "telegram", "teams"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelConfigByType {
  /** Comma-separated addresses. */
  email: { to: string };
  /** Payload signed with HMAC-SHA256 of `secret` in the X-Referzen-Signature header. */
  webhook: { url: string; secret: string };
  slack: { webhookUrl: string };
  discord: { webhookUrl: string };
  teams: { webhookUrl: string };
  telegram: { botToken: string; chatId: string };
}
export type ChannelConfig<T extends ChannelType = ChannelType> = ChannelConfigByType[T];

export const ALERT_EVENTS = ["new_affiliate", "new_conversion", "conversion_reversed", "payout_paid", "quota_warning", "quota_reached", "test"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** What every alert channel receives (also the JSON body of webhook alerts). */
export interface AlertPayload {
  event: AlertEvent;
  program: { id: number; name: string; slug: string } | null;
  /** Human-readable one-line summary, e.g. "New conversion: $49.00 order via jane (commission $9.80)". */
  message: string;
  /** Facts behind the alert (affiliate, amount, commission, used, limit…). */
  data: Record<string, number | string>;
  /** Link to the program in the merchant dashboard. */
  url: string;
  sentAt: string;
}
