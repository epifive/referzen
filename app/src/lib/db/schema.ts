import type { Generated, Insertable, Selectable, Updateable } from "kysely";

/**
 * Database schema shared by the MySQL and SQLite drivers.
 *
 * Portability rules used across the project:
 * - booleans are stored as 0 / 1 integers
 * - timestamps are ISO-8601 strings (see `now()` in ./index.ts)
 * - money is stored in the smallest currency unit (cents)
 */

export interface SettingsTable {
  key: string;
  value: string | null;
}

export interface UsersTable {
  id: Generated<number>;
  name: string;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "banned";
  plan_id: number | null;
  plan_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PasswordResetsTable {
  token_hash: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface PlansTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string | null;
  /** Referral programs per account; 0 = unlimited. */
  max_programs: number;
  /** Affiliates across all programs of the account; 0 = unlimited. */
  max_affiliates: number;
  /** Conversions recorded per calendar month (all programs); 0 = unlimited. */
  max_monthly_conversions: number;
  /** REST API access (/api/v1). */
  allow_api: number;
  /** Hide the "Powered by" line in affiliate portals and emails. */
  remove_branding: number;
  is_free: number;
  is_active: number;
  is_featured: number;
  sort_order: number;
  created_at: string;
}

export interface PaymentsTable {
  id: Generated<number>;
  user_id: number;
  plan_id: number;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly";
  provider: "stripe" | "paypal" | "razorpay" | "offline";
  provider_ref: string;
  status: "pending" | "paid" | "rejected" | "refunded";
  note: string | null;
  created_at: string;
}

export interface PagesTable {
  id: Generated<number>;
  slug: string;
  title: string;
  content: string;
  meta_description: string | null;
  is_published: number;
  show_in_footer: number;
  created_at: string;
  updated_at: string;
}

export interface ContactMessagesTable {
  id: Generated<number>;
  name: string;
  email: string;
  subject: string;
  message: string;
  ip: string | null;
  is_read: number;
  created_at: string;
}

export interface LanguagesTable {
  code: string;
  name: string;
  native_name: string;
  direction: "ltr" | "rtl";
  is_active: number;
  sort_order: number;
}

export interface TranslationsTable {
  lang: string;
  key: string;
  value: string;
}

export interface PostsTable {
  id: Generated<number>;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  meta_description: string | null;
  status: "draft" | "published";
  published_at: string | null;
  views: number;
  created_at: string;
  updated_at: string;
}

// ── Referral programs ──

export interface ProgramsTable {
  id: Generated<number>;
  /** Owner (merchant). */
  user_id: number;
  name: string;
  /** Public affiliate portal: /a/<slug> (unique, see normalizeSlug()). */
  slug: string;
  /** Merchant website, bare hostname ("example.com"); clicks from other hosts are refused. */
  domain: string;
  /** ISO 4217 currency of commissions and payouts. */
  currency: string;
  /** JSON: ProgramSettings (see src/referral/types.ts). */
  settings: string;
  /** "active" | "paused" (paused: no new clicks, conversions or sign-ups). */
  status: "active" | "paused";
  /** Public id used by the tracking snippet (data-program attribute). */
  public_key: string;
  /** Secret part of the incoming webhook URL /api/hooks/<token>. */
  webhook_token: string;
  /** Optional provider signing secret (Stripe "whsec_…") used to verify webhook signatures. */
  webhook_secret: string | null;
  /** First click received (installation verified). */
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliatesTable {
  id: Generated<number>;
  program_id: number;
  /** Lowercase; unique per program. */
  email: string;
  name: string;
  /** scrypt hash (src/lib/auth/password.ts); null for invited affiliates who haven't set one. */
  password_hash: string | null;
  status: "pending" | "approved" | "blocked";
  /** Referral code (?ref=CODE), lowercase, unique per program. */
  code: string;
  /** Optional coupon code shown in the portal (created by the merchant in their shop). */
  coupon_code: string | null;
  /** JSON CommissionOverride or null (program commission). */
  commission_override: string | null;
  payout_method: "paypal" | "bank" | "other";
  /** JSON PayoutDetails for payout_method. */
  payout_details: string;
  website: string | null;
  /** Private merchant notes. */
  notes: string | null;
  /** Hash of the affiliate's own visitor fingerprint at their last login (self-referral checks). */
  last_visitor_hash: string | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Affiliate portal sessions (separate from platform users' sessions). */
export interface AffiliateSessionsTable {
  /** sha256 of the session cookie value. */
  id: string;
  affiliate_id: number;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AffiliatePasswordResetsTable {
  token_hash: string;
  affiliate_id: number;
  expires_at: string;
  created_at: string;
}

/** One row per referral link visit (kept 90 days; click_daily keeps the counts for good). */
export interface ClicksTable {
  id: Generated<number>;
  program_id: number;
  affiliate_id: number;
  /** ISO time (UTC). */
  ts: string;
  /** Referral token handed to the browser for this click (rz_ref cookie). */
  token: string;
  landing_path: string;
  referrer_host: string;
  /** Daily-salted hash of IP + user agent + program (no IP stored). */
  visitor_hash: string;
  /** ISO 3166-1 alpha-2 or "". */
  country: string;
  /** desktop | mobile | tablet */
  device: string;
  /** Campaign / sub id of the link (?sub=…) or "". */
  sub_id: string;
  /** 1 when the same visitor already clicked this affiliate's link today (not counted as unique). */
  is_duplicate: number;
}

export interface ClickDailyTable {
  program_id: number;
  affiliate_id: number;
  /** UTC day YYYY-MM-DD. */
  day: string;
  clicks: number;
  unique_clicks: number;
}

/** Leads: a referred visitor who signed up / was identified (email or customer id). */
export interface ReferralsTable {
  id: Generated<number>;
  program_id: number;
  affiliate_id: number;
  /** Referral token from the click (rz_ref) or a generated one for server-side referrals. */
  token: string;
  /** Customer email (plain, lowercase) — null when the program stores hashes only. */
  email: string | null;
  /** sha256 of the lowercase email (always set when an email is known; used for matching). */
  email_hash: string | null;
  /** Customer id in the merchant's system (Stripe "cus_…", Woo customer id…). */
  customer_ref: string | null;
  status: "lead" | "converted";
  /** Where the lead came from: js | api | stripe | woocommerce | shopify | generic | manual. */
  source: string;
  sub_id: string;
  created_at: string;
  converted_at: string | null;
}

export interface ConversionsTable {
  id: Generated<number>;
  program_id: number;
  affiliate_id: number;
  referral_id: number | null;
  /** stripe | woocommerce | shopify | generic | api | js | manual */
  source: string;
  /** Order / invoice / charge id; unique per (program_id, source, external_id). */
  external_id: string;
  /** Customer id in the merchant's system (subscription renewals are matched by it). */
  customer_ref: string | null;
  /** Subscription id for recurring payments (Stripe "sub_…"). */
  subscription_ref: string | null;
  /** Other id of the same payment (Stripe payment intent "pi_…") so refunds and disputes find it. */
  payment_ref: string | null;
  /** Charge id of the payment (Stripe "ch_…"), when known. */
  charge_ref: string | null;
  /** 1 = first payment of the customer, 2 = first renewal … (recurring limit). */
  nth: number;
  amount_cents: number;
  currency: string;
  commission_cents: number;
  status: "pending" | "approved" | "paid" | "reversed";
  /** Comma-separated ConversionFlag list ("self_referral,client_side") or "". */
  flags: string;
  /** Payout that paid this commission. */
  payout_id: number | null;
  occurred_at: string;
  approved_at: string | null;
  paid_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  /** Free-text note (manual conversions, merchant comments). */
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutBatchesTable {
  id: Generated<number>;
  program_id: number;
  status: "draft" | "paid";
  currency: string;
  total_cents: number;
  payout_count: number;
  note: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PayoutsTable {
  id: Generated<number>;
  program_id: number;
  affiliate_id: number;
  batch_id: number | null;
  amount_cents: number;
  currency: string;
  /** paypal | bank | other (copied from the affiliate when the payout was created). */
  method: string;
  /** JSON PayoutDetails snapshot at creation time. */
  details: string;
  status: "draft" | "paid" | "cancelled";
  /** Payment reference entered by the merchant (PayPal transaction id, bank reference…). */
  reference: string | null;
  conversion_count: number;
  /** Sum of the (negative) adjustments deducted from this payout; amount_cents is already net. */
  adjustment_cents: Generated<number>;
  created_at: string;
  paid_at: string | null;
}

/**
 * Balance adjustments of an affiliate, e.g. a negative one when a commission that was already
 * paid out is reversed (refund, dispute). Deducted from the next payout (payout_id set then).
 */
export interface AdjustmentsTable {
  id: Generated<number>;
  program_id: number;
  affiliate_id: number;
  /** The reversed conversion, when the adjustment comes from one. */
  conversion_id: number | null;
  /** Minor units of the program currency; negative = owed by the affiliate. */
  amount_cents: number;
  currency: string;
  reason: string | null;
  /** Payout the adjustment was deducted from (null = not applied yet). */
  payout_id: number | null;
  created_at: string;
}

/** Marketing material for affiliates: links, banners, text snippets, email templates. */
export interface AssetsTable {
  id: Generated<number>;
  program_id: number;
  type: "link" | "banner" | "text" | "email";
  title: string;
  /** Target page (link/banner) on the merchant website, "" = home page. */
  url: string;
  /** Banner image (upload path or URL). */
  image: string | null;
  /** Text / email body; {link} and {code} are replaced with the affiliate's values. */
  content: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKeysTable {
  id: Generated<number>;
  user_id: number;
  name: string;
  /** sha256 of the key; the key itself is shown once. */
  key_hash: string;
  /** First characters, to recognise the key in the list. */
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface UsageMonthlyTable {
  user_id: number;
  /** YYYY-MM */
  month: string;
  /** Conversions recorded this month (all programs of the user): the plan quota. */
  conversions: number;
  /** Referral clicks recorded this month (informational). */
  clicks: number;
}

export interface AlertChannelsTable {
  id: Generated<number>;
  user_id: number;
  type: "email" | "webhook" | "slack" | "discord" | "telegram" | "teams";
  name: string;
  /** JSON: channel config (see src/referral/types.ts). */
  config: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AlertLogTable {
  id: Generated<number>;
  program_id: number | null;
  channel_id: number | null;
  event: string;
  ok: number;
  error: string | null;
  created_at: string;
}

export interface Database {
  settings: SettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  password_resets: PasswordResetsTable;
  plans: PlansTable;
  payments: PaymentsTable;
  pages: PagesTable;
  contact_messages: ContactMessagesTable;
  languages: LanguagesTable;
  translations: TranslationsTable;
  posts: PostsTable;
  programs: ProgramsTable;
  affiliates: AffiliatesTable;
  affiliate_sessions: AffiliateSessionsTable;
  affiliate_password_resets: AffiliatePasswordResetsTable;
  clicks: ClicksTable;
  click_daily: ClickDailyTable;
  referrals: ReferralsTable;
  conversions: ConversionsTable;
  payout_batches: PayoutBatchesTable;
  payouts: PayoutsTable;
  adjustments: AdjustmentsTable;
  assets: AssetsTable;
  api_keys: ApiKeysTable;
  usage_monthly: UsageMonthlyTable;
  alert_channels: AlertChannelsTable;
  alert_log: AlertLogTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Plan = Selectable<PlansTable>;
export type Payment = Selectable<PaymentsTable>;
export type Page = Selectable<PagesTable>;
export type ContactMessage = Selectable<ContactMessagesTable>;
export type Language = Selectable<LanguagesTable>;
export type Post = Selectable<PostsTable>;
export type Program = Selectable<ProgramsTable>;
export type Affiliate = Selectable<AffiliatesTable>;
export type AffiliateSession = Selectable<AffiliateSessionsTable>;
export type Click = Selectable<ClicksTable>;
export type ClickDaily = Selectable<ClickDailyTable>;
export type Referral = Selectable<ReferralsTable>;
export type Conversion = Selectable<ConversionsTable>;
export type NewConversion = Insertable<ConversionsTable>;
export type PayoutBatch = Selectable<PayoutBatchesTable>;
export type Payout = Selectable<PayoutsTable>;
export type Adjustment = Selectable<AdjustmentsTable>;
export type Asset = Selectable<AssetsTable>;
export type ApiKey = Selectable<ApiKeysTable>;
export type AlertChannel = Selectable<AlertChannelsTable>;
