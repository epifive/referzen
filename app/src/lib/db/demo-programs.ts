import "server-only";
import type { Insertable, Kysely } from "kysely";
import { hashPassword } from "../auth/password";
import { demoAffiliateLogin } from "../config";
import { hashEmail, randomToken } from "../tokens";
import { computeCommission, normalizeProgramSettings } from "@/referral/normalize";
import type { CommissionOverride, ConversionFlag, ConversionSource, PayoutDetails, PayoutMethod, ProgramSettings } from "@/referral/types";
import type {
  AssetsTable,
  ClickDailyTable,
  ClicksTable,
  ConversionsTable,
  Database,
  PayoutBatchesTable,
  PayoutsTable,
  ReferralsTable,
} from "./schema";

/**
 * Demo referral programs for a public demo, owned by the administrator:
 *   - "Northwind" (SaaS, Stripe, 30 % recurring for 12 months, USD) — the showcase program,
 *   - "Acme Store" (WooCommerce shop, 10 % per order, EUR, affiliates approved by hand),
 * plus three small programs of sample customers so Admin → Programs looks busy.
 *
 * 90 days of activity come from one model (growth, weekdays, campaign spikes, per-affiliate
 * audiences), so raw rows and daily summaries follow the same definitions:
 *   - the last RAW_DAYS UTC days (today included) are stored as raw clicks,
 *   - older days go straight to click_daily, and the settings row "click_rollup_until" is set
 *     to the newest summarised day, so the click-rollups job summarises the raw days itself
 *     and nothing is counted twice (see src/lib/jobs/click-rollups.ts and portal-stats.ts).
 * Leads, conversions (Stripe subscriptions with renewals, shop orders, refunds, fraud flags),
 * payout batches (paid + draft), marketing assets and monthly usage are derived from the
 * same clicks. Deterministic for a given `rand`; about 10,000 rows in ~45 multi-row inserts
 * so a remote cloud database seeds within one request.
 */

type Db = Kysely<Database>;
type Rand = () => number;
type W<T> = ReadonlyArray<readonly [T, number]>;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Days of activity (today included). */
const DAYS = 90;
/** Most recent UTC days kept as raw clicks (today included); older days are click_daily rows. */
const RAW_DAYS = 14;
/** Share of clicks that repeat a visitor of the same affiliate on the same day. */
const DUP_RATE = 0.13;
const CLICK_CHUNK = 400;
const ROW_CHUNK = 300;
const DAILY_CHUNK = 500;

// ── Specs ──

interface AffSpec {
  name: string;
  website?: string;
  /** Share of the program's traffic (0 = no clicks). */
  weight: number;
  /** Days ago the affiliate signed up. */
  joined: number;
  status?: "approved" | "pending" | "blocked";
  /** Blocked affiliates: days ago they were blocked (no clicks since, commissions reversed). */
  blocked?: number;
  code?: string;
  coupon?: string;
  override?: CommissionOverride;
  method?: PayoutMethod;
  /** Has not entered payout details yet. */
  noDetails?: boolean;
  /** Invited by the merchant, no password yet. */
  invited?: boolean;
  /** The ready-made portal account (DEMO_AFFILIATE_EMAIL / _PASSWORD). */
  demo?: boolean;
  /** Home country (boosts it in the click countries, bank details). */
  country?: string;
  subs?: string[];
  refs?: W<string>;
  /** Conversion quality multiplier. */
  boost?: number;
  /** Traffic spikes: days-ago ranges (inclusive) with a multiplier. */
  spikes?: Array<{ from: number; to: number; mult: number }>;
  notes?: string;
}

interface Plan {
  cents: number;
  yearly?: boolean;
}

interface FlagPick {
  flag: ConversionFlag;
  count: number;
}

interface ProgramSpec {
  name: string;
  slug: string;
  domain: string;
  currency: string;
  ownerId: number;
  createdDaysAgo: number;
  settings: Partial<ProgramSettings>;
  model: "saas" | "store";
  source: ConversionSource;
  /** Clicks per day 90 days ago → today (before weekday factors). */
  clicks: readonly [number, number];
  /** Multiplier by UTC weekday, 0 = Sunday. */
  weekday: readonly number[];
  spikes?: Array<{ from: number; to: number; mult: number }>;
  /** saas: sign-ups per unique click; store: newsletter leads per unique click. */
  leadRate: number;
  /** saas: share of sign-ups that pay; store: orders per unique click. */
  payRate: number;
  plans?: W<Plan>;
  orderValue?: (r: Rand) => number;
  orderId?: (n: number, r: Rand) => string;
  /** store: share of orders from registered customers that also create a referral row. */
  referralShare?: number;
  refundRate: number;
  refundReasons: readonly string[];
  /** saas: chance a subscription is cancelled after each payment. */
  churn?: number;
  countries: W<string>;
  devices: W<string>;
  paths: W<string>;
  emailDomains: W<string>;
  flags?: FlagPick[];
  /** Payout runs: days ago, paid or still a draft. */
  batches?: Array<{ daysAgo: number; paid: boolean; note: string }>;
  assets: Array<Pick<Insertable<AssetsTable>, "type" | "title" | "url" | "image" | "content">>;
  affiliates: AffSpec[];
}

// ── Helpers ──

/** mulberry32: small, fast and well distributed (the caller's rand() only seeds it). */
function makeRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickW<T>(r: Rand, items: W<T>): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x < 0) return v;
  }
  return items[items.length - 1][0];
}

const pick = <T,>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const rid = (r: Rand, n: number, alphabet = ALNUM) => Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
const hex = (r: Rand, n: number) => rid(r, n, "0123456789abcdef");
const digits = (r: Rand, n: number) => rid(r, n, "0123456789");
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (ms: number) => iso(ms).slice(0, 10);
const dayStart = (ms: number) => Date.parse(`${dayOf(ms)}T00:00:00.000Z`);
const ascii = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");

function addMonths(ms: number, k: number): number {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), last));
  return t.getTime();
}

/** Clicks by UTC hour (Europe + Americas audience). */
const HOURS = [2, 1.5, 1, 1, 1, 1.5, 2.5, 4, 5.5, 6.5, 7, 7, 7, 7, 7.5, 8, 8, 7.5, 7, 6.5, 6, 5, 4, 3];
const HOUR_W: W<number> = HOURS.map((w, h) => [h, w] as const);
const timeOfDay = (r: Rand) => pickW(r, HOUR_W) * HOUR + Math.floor(r() * HOUR);

const FIRST = ["Emma", "Liam", "Olivia", "James", "Sophia", "Lucas", "Mia", "Ethan", "Amelia", "Mason", "Harper", "Logan", "Ella", "Jack", "Aria", "Leo", "Chloe", "Henry", "Nora", "Felix", "Ivy", "Oscar", "Ruby", "Hugo", "Alice", "Theo", "Clara", "Max", "Lena", "Adam", "Sara", "Ravi", "Anika", "Kenji", "Yara", "Omar", "Elif", "Diego", "Marta", "Tobias"];
const LAST = ["Smith", "Meyer", "Garcia", "Brown", "Rossi", "Dubois", "Kowalski", "Jansen", "Novak", "Silva", "Andersson", "Murphy", "Schulz", "Lopez", "Walker", "Bauer", "Moreau", "Ricci", "Mehta", "Sato", "Hughes", "Fischer", "Costa", "Evans", "Lindqvist", "Nowak", "Bakker", "Wright", "Keller", "Romero"];

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  NL: "Netherlands",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  AT: "Austria",
  PL: "Poland",
  SE: "Sweden",
  DK: "Denmark",
  IN: "India",
  BR: "Brazil",
  JP: "Japan",
};
const IBAN: Record<string, { len: number; bank: string; bic: string; letters?: string }> = {
  DE: { len: 22, bank: "Deutsche Kreditbank", bic: "BYLADEM1001" },
  NL: { len: 18, bank: "ING Bank", bic: "INGBNL2A", letters: "INGB" },
  FR: { len: 27, bank: "BNP Paribas", bic: "BNPAFRPP" },
  ES: { len: 24, bank: "BBVA", bic: "BBVAESMM" },
  IT: { len: 27, bank: "Intesa Sanpaolo", bic: "BCITITMM" },
  AT: { len: 20, bank: "Erste Bank", bic: "GIBAATWW" },
  PL: { len: 28, bank: "mBank", bic: "BREXPLPW" },
  SE: { len: 24, bank: "Swedbank", bic: "SWEDSESS" },
  DK: { len: 18, bank: "Danske Bank", bic: "DABADKKK" },
};

function bankDetails(r: Rand, name: string, country: string): PayoutDetails {
  const countryName = COUNTRY_NAMES[country] ?? country;
  if (country === "US") return { accountName: name, accountNumber: digits(r, 10), bankCode: `0${digits(r, 8)}`, bankName: "Chase Bank", country: countryName };
  if (country === "GB") return { accountName: name, accountNumber: digits(r, 8), bankCode: `${digits(r, 2)}-${digits(r, 2)}-${digits(r, 2)}`, bankName: "Monzo Bank", country: countryName };
  if (country === "IN") return { accountName: name, accountNumber: digits(r, 14), bankCode: `HDFC0${digits(r, 6)}`, bankName: "HDFC Bank", country: countryName };
  const spec = IBAN[country] ?? IBAN.DE;
  const cc = IBAN[country] ? country : "DE";
  const raw = `${cc}${digits(r, 2)}${spec.letters ?? ""}${digits(r, spec.len - 4 - (spec.letters?.length ?? 0))}`;
  return { accountName: name, accountNumber: raw.replace(/(.{4})/g, "$1 ").trim(), bankCode: spec.bic, bankName: spec.bank, country: COUNTRY_NAMES[cc] };
}

function isPublicHost(siteUrl: string): string | null {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    if (/(^|\.)(localhost|local|test|example|internal|lan|home)$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

// ── Program definitions ──

const NORTHWIND_TERMS = `## Northwind Partner Program terms

1. **Commission.** You earn 30% of every payment made by customers you refer, for their first 12 months. Commissions are single-tier: you earn on the customers you refer yourself.
2. **Attribution.** A referral counts when the customer starts a trial or subscribes within 60 days of clicking your link (last click wins). Coupon codes assigned to you count as your referrals too.
3. **Approval and payouts.** Commissions stay pending for 30 days (our refund window), then they are approved. Approved balances of $50 or more are paid at the start of each month by PayPal or bank transfer; smaller balances roll over.
4. **Not allowed.** Paid search ads on "Northwind" or misspellings of it, coupon and cashback sites, cookie stuffing, spam, and buying through your own link. Commissions from these are reversed and the account may be blocked.
5. **Refunds.** If a payment is refunded or disputed, its commission is reversed.
6. Questions? Write to partners@northwind.example.`;

const ACME_TERMS = `## Acme Store affiliate terms

- You earn **10% of every order** placed within 30 days of a click on your link (shipping and taxes excluded where possible).
- Applications are reviewed by hand, usually within two working days.
- Commissions are approved after our 14-day return window and paid monthly once your balance reaches EUR 25.
- Returned or cancelled orders don't earn a commission.
- Please don't bid on "Acme Store" in search ads or post our coupon codes on coupon sites.`;

function adminPrograms(adminId: number, northwindDomain: string): ProgramSpec[] {
  const northwind: ProgramSpec = {
    name: "Northwind",
    slug: "northwind",
    domain: northwindDomain,
    currency: "USD",
    ownerId: adminId,
    createdDaysAgo: 95,
    model: "saas",
    source: "stripe",
    settings: {
      commissionType: "percent",
      rate: 3000,
      recurring: { mode: "months", months: 12 },
      cookieDays: 60,
      holdDays: 30,
      minPayoutCents: 5000,
      payoutMethods: ["paypal", "bank"],
      autoApprove: true,
      terms: NORTHWIND_TERMS,
      portalHeadline: "Earn 30% recurring for 12 months",
      portalIntro:
        "Recommend Northwind, the calm planning tool for remote teams, and earn 30% of every payment your referrals make in their first year. 60-day cookie, monthly payouts by PayPal or bank transfer, and a dashboard with every click and commission.",
      brandColor: "#2563eb",
      logo: "/demo/northwind-logo.svg",
      leadEmailMode: "plain",
      notifyEvents: ["new_affiliate", "new_conversion", "conversion_reversed", "payout_paid"],
      emailAffiliates: true,
    },
    clicks: [85, 175],
    weekday: [0.62, 1.1, 1.16, 1.12, 1.06, 0.94, 0.6],
    leadRate: 0.034,
    payRate: 0.52,
    plans: [
      [{ cents: 2900 }, 44],
      [{ cents: 7900 }, 34],
      [{ cents: 19900 }, 8],
      [{ cents: 29000, yearly: true }, 8],
      [{ cents: 79000, yearly: true }, 6],
    ],
    churn: 0.06,
    refundRate: 0.045,
    refundReasons: ["Refunded in Stripe (charge.refunded)", "Payment disputed (charge.dispute.created)", "Refunded: cancelled in the first week"],
    countries: [["US", 32], ["GB", 10], ["DE", 8], ["IN", 7], ["CA", 6], ["FR", 4], ["AU", 4], ["NL", 3], ["BR", 3], ["ES", 3], ["SE", 2], ["JP", 2], ["PL", 2], ["IT", 2], ["SG", 1], ["", 2]],
    devices: [["desktop", 68], ["mobile", 27], ["tablet", 5]],
    paths: [["/", 40], ["/pricing", 20], ["/features", 10], ["/signup", 6], ["/blog/remote-team-okrs", 6], ["/integrations", 5], ["/compare/asana", 4], ["/templates/weekly-check-in", 3]],
    emailDomains: [["gmail.com", 34], ["outlook.com", 8], ["icloud.com", 5], ["proton.me", 3], ["brightlabs.io", 2], ["kestrel.co", 2], ["northpeak.studio", 2], ["fieldnotes.app", 2], ["lumen-health.com", 2], ["tidewater.dev", 2], ["orbitcrm.io", 2], ["papertrail.agency", 2]],
    flags: [
      { flag: "self_referral", count: 2 },
      { flag: "same_visitor", count: 1 },
    ],
    batches: [
      { daysAgo: 50, paid: true, note: "Monthly payout run: PayPal Payouts CSV + bank transfers" },
      { daysAgo: 20, paid: true, note: "Monthly payout run: PayPal Payouts CSV + bank transfers" },
      { daysAgo: 2, paid: false, note: "Next payout run (review before paying)" },
    ],
    assets: [
      { type: "link", title: "Home page", url: "", image: null, content: null },
      { type: "link", title: "Pricing", url: "/pricing", image: null, content: null },
      { type: "link", title: "14-day free trial", url: "/signup", image: null, content: null },
      { type: "banner", title: "Leaderboard 728x90", url: "/", image: "/demo/northwind-banner-728x90.svg", content: null },
      { type: "banner", title: "Medium rectangle 300x250", url: "/pricing", image: "/demo/northwind-banner-300x250.svg", content: null },
      {
        type: "text",
        title: "Short description",
        url: "",
        image: null,
        content: "Northwind keeps remote teams on the same page: projects, OKRs and weekly check-ins in one calm workspace. Try it free for 14 days: {link}",
      },
      {
        type: "text",
        title: "Social post",
        url: "",
        image: null,
        content: "We moved our 12-person remote team to Northwind last quarter and stopped losing decisions in chat threads. Weekly check-ins take 5 minutes now. Free 14-day trial: {link}",
      },
      {
        type: "email",
        title: "Newsletter swipe",
        url: "/signup",
        image: null,
        content:
          "Subject: How we run a remote team without status meetings\n\nHi there,\n\nFor the last few months we have planned every project in Northwind. Everyone writes a short weekly check-in, goals and tasks live in one place, and our Monday status call is gone.\n\nIf your team is spread across time zones, give it a try. The trial is free for 14 days and you don't need a card:\n\n{link}\n\n(Full disclosure: this is my partner link, so Northwind pays me a commission if you subscribe.)",
      },
    ],
    affiliates: [
      { name: "Maya Chen", website: "theremoteplaybook.com", code: "remoteplaybook", weight: 15, joined: 93, override: { rate: 4000 }, coupon: "PLAYBOOK", subs: ["issue-112", "issue-116", "issue-121", "welcome-email"], refs: [["", 6], ["mail.google.com", 2], ["theremoteplaybook.com", 3]], boost: 1.3, country: "US", notes: "Top partner. 40% commission agreed on a call in July." },
      { name: "Jordan Avery", demo: true, website: "averyonproductivity.com", code: "jordan", weight: 11, joined: 92, coupon: "AVERY20", subs: ["newsletter", "youtube", "blog-sidebar"], refs: [["averyonproductivity.com", 5], ["youtube.com", 3], ["", 3], ["t.co", 1]], boost: 1.15, country: "US" },
      { name: "Lukas Becker", website: "lukasbecker.de", weight: 9, joined: 88, coupon: "LUKAS15", method: "bank", country: "DE", subs: ["yt-review", "yt-tutorial"], refs: [["youtube.com", 7], ["lukasbecker.de", 2], ["", 1]], spikes: [{ from: 47, to: 44, mult: 4 }] },
      { name: "Priya Raman", website: "saasstackreview.com", weight: 8, joined: 90, country: "IN", subs: ["comparison", "best-pm-tools"], refs: [["saasstackreview.com", 6], ["google.com", 3], ["", 1]] },
      { name: "Tom Fletcher", website: "fletcherdigital.co.uk", weight: 5, joined: 85, method: "bank", country: "GB", override: { rate: 3500 }, refs: [["fletcherdigital.co.uk", 4], ["linkedin.com", 3], ["", 3]], boost: 1.4, notes: "Agency partner: sets Northwind up for client teams. 35% rate." },
      { name: "Sofia Martins", website: "sofiamartins.com.br", weight: 4, joined: 80, country: "BR", refs: [["instagram.com", 4], ["", 2]] },
      { name: "Daniel Okafor", website: "builtremote.io", weight: 4, joined: 78, refs: [["builtremote.io", 3], ["reddit.com", 2], ["", 2]] },
      { name: "Emily Novak", website: "teamrituals.blog", weight: 3, joined: 74 },
      { name: "Ethan Wright", website: "bestsoftwaredeals.net", weight: 3, joined: 75, status: "blocked", blocked: 25, boost: 1.5, refs: [["google.com", 6], ["bestsoftwaredeals.net", 2]], notes: "Blocked: ran Google Ads on our brand name (terms section 4). Open commissions reversed." },
      { name: "Hiroshi Sato", website: "hiroshisato.jp", weight: 3, joined: 70, country: "JP" },
      { name: "Grace Liu", website: "pmweekly.net", weight: 3, joined: 66, subs: ["newsletter"] },
      { name: "Marco Bianchi", website: "marcobianchi.it", weight: 2.5, joined: 60, method: "bank", country: "IT" },
      { name: "Aisha Rahman", website: "asyncworkguide.com", weight: 2.5, joined: 57, country: "GB" },
      { name: "Isabel Torres", website: "isabeltorres.es", weight: 1.5, joined: 50, country: "ES" },
      { name: "Zoe Adams", weight: 0.8, joined: 45 },
      { name: "Ben Carter", website: "carterconsulting.com", weight: 2, joined: 42 },
      { name: "Sam Rivera", weight: 0.8, joined: 38, noDetails: true },
      { name: "Chloe Dubois", website: "chloedubois.fr", weight: 2, joined: 33, country: "FR", method: "bank" },
      { name: "Noah Williams", website: "noahbuilds.dev", weight: 1.5, joined: 24 },
      { name: "Ryan Patel", weight: 1.2, joined: 64 },
      { name: "Hannah Schmidt", weight: 1, joined: 11, country: "DE" },
      { name: "Oliver Brooks", website: "oliverbrooks.co", weight: 1, joined: 7 },
      { name: "Kavya Iyer", weight: 0.7, joined: 5, country: "IN" },
      { name: "Ava Thompson", weight: 0, joined: 3, invited: true, noDetails: true, notes: "Invited after our partner webinar." },
    ],
  };

  const acmeItems: W<number> = [[2490, 3], [3490, 4], [4990, 4], [6990, 3], [8900, 2], [12900, 2], [18900, 1]];
  const acme: ProgramSpec = {
    name: "Acme Store",
    slug: "acme",
    domain: "acme.example",
    currency: "EUR",
    ownerId: adminId,
    createdDaysAgo: 93,
    model: "store",
    source: "woocommerce",
    settings: {
      commissionType: "percent",
      rate: 1000,
      recurring: { mode: "none", months: 12 },
      cookieDays: 30,
      holdDays: 14,
      minPayoutCents: 2500,
      payoutMethods: ["paypal", "bank"],
      autoApprove: false,
      terms: ACME_TERMS,
      portalHeadline: "Earn 10% on every order",
      portalIntro: "Share slow-made knitwear, bags and homeware you love. Every order within 30 days of your link earns you 10%, paid monthly.",
      brandColor: "#ea580c",
      leadEmailMode: "plain",
      notifyEvents: ["new_affiliate", "new_conversion", "conversion_reversed"],
      emailAffiliates: true,
    },
    clicks: [70, 120],
    weekday: [1.22, 0.9, 0.88, 0.92, 0.98, 1.06, 1.26],
    spikes: [{ from: 24, to: 21, mult: 1.9 }],
    leadRate: 0.007,
    payRate: 0.043,
    orderValue: (r) => {
      const n = pickW(r, [[1, 60], [2, 30], [3, 10]] as const);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += pickW(r, acmeItems);
      return sum >= 5000 ? sum : sum + 495;
    },
    orderId: (n) => String(10480 + n),
    referralShare: 0.3,
    refundRate: 0.06,
    refundReasons: ["Order refunded in WooCommerce", "Order cancelled before shipping", "Returned within 14 days"],
    countries: [["DE", 22], ["FR", 13], ["NL", 9], ["ES", 7], ["IT", 7], ["AT", 4], ["BE", 4], ["GB", 6], ["US", 6], ["PL", 4], ["SE", 3], ["DK", 2], ["IE", 2], ["", 2]],
    devices: [["mobile", 58], ["desktop", 36], ["tablet", 6]],
    paths: [["/", 30], ["/shop", 18], ["/collections/autumn-sale", 14], ["/product/merino-wool-beanie", 9], ["/product/canvas-weekender-bag", 8], ["/product/ceramic-pour-over-set", 6], ["/product/linen-throw-blanket", 5]],
    emailDomains: [["gmail.com", 30], ["web.de", 7], ["gmx.de", 6], ["outlook.com", 6], ["orange.fr", 4], ["icloud.com", 4], ["libero.it", 3], ["hotmail.com", 3], ["ziggo.nl", 2], ["wp.pl", 2]],
    flags: [
      { flag: "same_visitor", count: 1 },
      { flag: "duplicate_customer", count: 1 },
    ],
    batches: [
      { daysAgo: 48, paid: true, note: "Monthly payouts" },
      { daysAgo: 18, paid: true, note: "Monthly payouts" },
    ],
    assets: [
      { type: "link", title: "Shop home", url: "", image: null, content: null },
      { type: "link", title: "Autumn sale", url: "/collections/autumn-sale", image: null, content: null },
      { type: "banner", title: "Autumn sale 300x250", url: "/collections/autumn-sale", image: "/demo/acme-banner-300x250.svg", content: null },
      { type: "text", title: "Instagram caption", url: "", image: null, content: "Cosy season is here. My favourite merino beanie and the canvas weekender are up to 30% off at Acme Store this week: {link}" },
    ],
    affiliates: [
      { name: "Julia Weber", website: "juliasfinds.de", weight: 10, joined: 92, coupon: "JULIA10", country: "DE", method: "bank", subs: ["insta-story", "blog"], refs: [["instagram.com", 5], ["juliasfinds.de", 3], ["", 2]] },
      { name: "Camille Laurent", website: "camillelaurent.fr", weight: 8, joined: 90, country: "FR", override: { commissionType: "fixed", rate: 1500 }, refs: [["instagram.com", 6], ["tiktok.com", 3], ["", 1]], notes: "Influencer deal: flat EUR 15 per order." },
      { name: "Pieter de Vries", website: "dealjager.nl", code: "dealjager", weight: 7, joined: 89, coupon: "DEALJAGER", country: "NL", method: "bank", boost: 1.3, refs: [["dealjager.nl", 8], ["", 2]] },
      { name: "Elena Rossi", website: "elenarossi.it", weight: 5, joined: 80, country: "IT" },
      { name: "Javier Moreno", website: "viajeroligero.es", weight: 4, joined: 76, country: "ES", method: "bank" },
      { name: "Anna Kowalska", website: "annakowalska.pl", weight: 3, joined: 70, country: "PL" },
      { name: "Sophie Martin", website: "sophiemartin.fr", weight: 3, joined: 66, country: "FR" },
      { name: "Jordan Avery", demo: true, website: "averyonproductivity.com", code: "jordan", weight: 1.5, joined: 60, country: "US" },
      { name: "Lars Nilsson", website: "larsoutdoors.se", weight: 2, joined: 58, country: "SE" },
      { name: "Emma Wilson", website: "emmawilsonstyle.co.uk", weight: 2, joined: 52, country: "GB" },
      { name: "Mateo Silva", weight: 1.5, joined: 35, country: "ES" },
      { name: "Nina Hoffmann", website: "ninahoffmann.at", weight: 1, joined: 12, country: "AT", method: "bank" },
      { name: "Sven Larsen", website: "svenlarsen.dk", weight: 0, joined: 4, status: "pending", country: "DK" },
      { name: "Felix Wagner", website: "felixwagner.de", weight: 0, joined: 2, status: "pending", country: "DE" },
      { name: "Léa Moreau", weight: 0, joined: 1, status: "pending", country: "FR" },
    ],
  };
  return [northwind, acme];
}

function customerPrograms(owners: number[]): ProgramSpec[] {
  const base = {
    weekday: [0.9, 1.05, 1.05, 1.05, 1.0, 0.95, 0.9],
    refundRate: 0.04,
    countries: [["US", 40], ["GB", 12], ["CA", 8], ["DE", 8], ["AU", 6], ["IN", 6], ["FR", 4], ["", 2]] as W<string>,
    devices: [["desktop", 55], ["mobile", 40], ["tablet", 5]] as W<string>,
    emailDomains: [["gmail.com", 30], ["outlook.com", 8], ["icloud.com", 6], ["yahoo.com", 4]] as W<string>,
  };
  const specs: ProgramSpec[] = [
    {
      ...base,
      name: "Bloom Yoga Online",
      slug: "bloom-yoga",
      domain: "bloomyoga.example",
      currency: "USD",
      ownerId: 0,
      createdDaysAgo: 75,
      model: "store",
      source: "generic",
      settings: { commissionType: "fixed", rate: 2000, cookieDays: 30, holdDays: 14, minPayoutCents: 5000, payoutMethods: ["paypal"], brandColor: "#16a34a", portalHeadline: "Earn $20 for every new member" },
      clicks: [4, 11],
      leadRate: 0.02,
      payRate: 0.05,
      orderValue: (r) => pickW(r, [[3900, 7], [29000, 3]] as const),
      orderId: (n) => `BY-${2210 + n}`,
      referralShare: 0.6,
      refundReasons: ["Membership refunded"],
      paths: [["/", 50], ["/classes", 25], ["/membership", 25]],
      batches: [{ daysAgo: 12, paid: true, note: "Monthly payouts" }],
      assets: [{ type: "link", title: "Membership page", url: "/membership", image: null, content: null }],
      affiliates: [
        { name: "Mira Patel", website: "mirapatelyoga.com", weight: 5, joined: 74 },
        { name: "Jonas Berg", weight: 3, joined: 60, country: "DE" },
        { name: "Olivia Grant", website: "slowmorningsblog.com", weight: 3, joined: 45 },
        { name: "Ines Duarte", weight: 1, joined: 20 },
      ],
    },
    {
      ...base,
      name: "PixelForge UI Kits",
      slug: "pixelforge",
      domain: "pixelforge.example",
      currency: "USD",
      ownerId: 0,
      createdDaysAgo: 62,
      model: "store",
      source: "shopify",
      settings: { commissionType: "percent", rate: 2500, cookieDays: 45, holdDays: 30, minPayoutCents: 5000, payoutMethods: ["paypal"], brandColor: "#7c3aed" },
      clicks: [6, 14],
      leadRate: 0,
      payRate: 0.04,
      orderValue: (r) => pickW(r, [[4900, 4], [7900, 4], [14900, 2]] as const),
      orderId: (n) => String(5_381_200_000_000 + n * 7919),
      referralShare: 0,
      refundReasons: ["Refunded in Shopify (refunds/create)"],
      paths: [["/", 40], ["/products/dashboard-kit", 30], ["/products/icon-pack", 30]],
      assets: [{ type: "link", title: "All UI kits", url: "/collections/all", image: null, content: null }],
      affiliates: [
        { name: "Kai Nakamura", website: "kaidesigns.tv", weight: 5, joined: 61, country: "JP" },
        { name: "Laura Jensen", website: "pixelperfectweekly.com", weight: 4, joined: 58 },
        { name: "Dev Malhotra", weight: 3, joined: 40, country: "IN" },
        { name: "Rosa Alvarez", weight: 2, joined: 30 },
        { name: "Finn O'Brien", weight: 1, joined: 9, country: "GB" },
      ],
    },
    {
      ...base,
      name: "Ledgerly",
      slug: "ledgerly",
      domain: "ledgerly.example",
      currency: "GBP",
      ownerId: 0,
      createdDaysAgo: 70,
      model: "saas",
      source: "stripe",
      settings: { commissionType: "percent", rate: 2000, recurring: { mode: "lifetime", months: 12 }, cookieDays: 90, holdDays: 30, minPayoutCents: 3000, payoutMethods: ["paypal", "bank"], brandColor: "#0f766e" },
      clicks: [3, 8],
      leadRate: 0.06,
      payRate: 0.45,
      plans: [
        [{ cents: 1200 }, 6],
        [{ cents: 2900 }, 3],
        [{ cents: 12000, yearly: true }, 1],
      ],
      churn: 0.04,
      refundReasons: ["Refunded in Stripe (charge.refunded)"],
      countries: [["GB", 60], ["IE", 10], ["US", 10], ["", 2]],
      paths: [["/", 50], ["/pricing", 30], ["/for-accountants", 20]],
      assets: [{ type: "link", title: "Pricing", url: "/pricing", image: null, content: null }],
      affiliates: [
        { name: "Harriet Cole", website: "colebookkeeping.co.uk", weight: 4, joined: 68, country: "GB", method: "bank" },
        { name: "Amir Haddad", weight: 3, joined: 55, country: "GB" },
        { name: "Megan Price", website: "smallbizsums.co.uk", weight: 2, joined: 40, country: "GB" },
        { name: "Callum Reid", weight: 1, joined: 15, country: "GB" },
      ],
    },
  ];
  return specs.slice(0, owners.length).map((s, i) => ({ ...s, ownerId: owners[i] }));
}

// ── Simulation ──

interface AffState {
  spec: AffSpec;
  id: number;
  email: string;
  override: CommissionOverride | null;
  method: PayoutMethod;
  details: PayoutDetails;
  hasDetails: boolean;
  blockedMs: number | null;
}

interface Visitor {
  token: string;
  hash: string;
  country: string;
  device: string;
  path: string;
  ref: string;
  sub: string;
}

interface ConvDraft {
  aff: AffState;
  refToken: string | null;
  externalId: string;
  customerRef: string | null;
  subscriptionRef: string | null;
  nth: number;
  amount: number;
  commission: number;
  occurred: number;
  refundAt: number | null;
  reason: string | null;
  note: string | null;
  flags: ConversionFlag[];
  source: ConversionSource;
  status: "pending" | "approved" | "paid" | "reversed";
  approvedAt: number | null;
  reversedAt: number | null;
  paidAt: number | null;
  payoutKey: string | null;
}

interface PayoutDraft {
  key: string;
  batchKey: string;
  aff: AffState;
  amount: number;
  count: number;
  created: number;
  paidAt: number | null;
  reference: string | null;
}

interface BatchDraft {
  key: string;
  paid: boolean;
  created: number;
  paidAt: number | null;
  note: string;
  payouts: PayoutDraft[];
}

interface Sim {
  spec: ProgramSpec;
  programId: number;
  settings: ProgramSettings;
  affs: AffState[];
  clicks: Insertable<ClicksTable>[];
  daily: Insertable<ClickDailyTable>[];
  refs: Insertable<ReferralsTable>[];
  convs: ConvDraft[];
  batches: BatchDraft[];
  clicksByMonth: Map<string, number>;
}

function simulate(sim: Sim, r: Rand, nowMs: number, emails: Set<string>): void {
  const { spec, settings } = sim;
  const firstDay = Math.min(DAYS - 1, spec.createdDaysAgo - 1);
  const holdMs = settings.holdDays * DAY;
  let orderCounter = 0;
  let wooCustomer = 1800 + Math.floor(r() * 400);

  const customerEmail = (): string => {
    const f = pick(r, FIRST).toLowerCase();
    const l = pick(r, LAST).toLowerCase();
    const style = r();
    const local = style < 0.45 ? `${f}.${l}` : style < 0.65 ? `${f}${l}` : style < 0.8 ? `${f[0]}.${l}` : `${f}${10 + Math.floor(r() * 89)}`;
    let email = `${local}@${pickW(r, spec.emailDomains)}`;
    for (let n = 2; emails.has(email); n++) email = `${local}${n}@${pickW(r, spec.emailDomains)}`;
    emails.add(email);
    return email;
  };

  const countMonth = (ms: number) => {
    const m = iso(ms).slice(0, 7);
    sim.clicksByMonth.set(m, (sim.clicksByMonth.get(m) ?? 0) + 1);
  };

  const newVisitor = (a: AffState): Visitor => {
    const s = a.spec;
    const host = s.website ? s.website : "";
    const refs: W<string> = s.refs ?? (host ? [[host, 5], ["", 3], ["t.co", 1], ["linkedin.com", 1]] : [["", 5], ["t.co", 1], ["facebook.com", 1]]);
    return {
      token: rid(r, 24),
      hash: hex(r, 32),
      country: s.country && r() < 0.45 ? s.country : pickW(r, spec.countries),
      device: pickW(r, spec.devices),
      path: pickW(r, spec.paths),
      ref: pickW(r, refs),
      sub: s.subs && r() < 0.7 ? pick(r, s.subs) : "",
    };
  };

  const addConversion = (c: Omit<ConvDraft, "status" | "approvedAt" | "reversedAt" | "paidAt" | "payoutKey" | "flags" | "note" | "source"> & { note?: string | null; source?: ConversionSource }) => {
    sim.convs.push({ ...c, note: c.note ?? null, source: c.source ?? spec.source, flags: [], status: "pending", approvedAt: null, reversedAt: null, paidAt: null, payoutKey: null });
  };

  /** What a unique click leads to: a sign-up (+ subscription) or an order. */
  const events = (a: AffState, ts: number, token: string, sub: string) => {
    const boost = a.spec.boost ?? 1;
    if (spec.model === "saas") {
      if (r() >= spec.leadRate * boost) return;
      const leadTs = ts + (2 + r() * 180) * MIN;
      if (leadTs > nowMs) return;
      const email = customerEmail();
      const ref: Insertable<ReferralsTable> = {
        program_id: sim.programId,
        affiliate_id: a.id,
        token,
        email,
        email_hash: hashEmail(email),
        customer_ref: null,
        status: "lead",
        source: "js",
        sub_id: sub,
        created_at: iso(leadTs),
        converted_at: null,
      };
      sim.refs.push(ref);
      if (r() >= spec.payRate) return;
      const first = leadTs + (r() < 0.35 ? (5 + r() * 55) * MIN : 14 * DAY + r() * 6 * HOUR);
      if (first > nowMs || (a.blockedMs !== null && first > a.blockedMs)) return;
      const customer = `cus_${rid(r, 14)}`;
      const subscription = `sub_1Q${rid(r, 22)}`;
      ref.customer_ref = customer;
      ref.status = "converted";
      ref.converted_at = iso(first);
      const plan = pickW(r, spec.plans ?? [[{ cents: 2900 }, 1]]);
      for (let k = 0; ; k++) {
        const payTs = addMonths(first, k);
        if (payTs > nowMs || (a.blockedMs !== null && payTs > a.blockedMs)) break;
        const refunded = r() < (k === 0 ? spec.refundRate : spec.refundRate / 3);
        addConversion({
          aff: a,
          refToken: token,
          externalId: `in_1Q${rid(r, 22)}`,
          customerRef: customer,
          subscriptionRef: subscription,
          nth: k + 1,
          amount: plan.cents,
          commission: computeCommission({ settings, affiliateOverride: a.override, amountCents: plan.cents, nth: k + 1, monthsSinceFirst: k }),
          occurred: payTs,
          refundAt: refunded ? payTs + (1 + r() * 9) * DAY : null,
          reason: refunded ? pick(r, spec.refundReasons) : null,
        });
        if (refunded || plan.yearly || r() < (spec.churn ?? 0)) break;
      }
      return;
    }

    // Store: a few newsletter leads, and orders.
    if (spec.leadRate > 0 && r() < spec.leadRate * boost) {
      const leadTs = ts + (1 + r() * 30) * MIN;
      if (leadTs <= nowMs) {
        const email = customerEmail();
        sim.refs.push({ program_id: sim.programId, affiliate_id: a.id, token, email, email_hash: hashEmail(email), customer_ref: null, status: "lead", source: "js", sub_id: sub, created_at: iso(leadTs), converted_at: null });
      }
    }
    if (r() >= spec.payRate * boost) return;
    const orderTs = ts + (r() < 0.7 ? (3 + r() * 40) * MIN : (1 + r() * 47) * HOUR);
    if (orderTs > nowMs || (a.blockedMs !== null && orderTs > a.blockedMs)) return;
    const registered = r() < 0.55;
    const customerRef = registered ? String(wooCustomer++) : null;
    let refToken: string | null = null;
    if (registered && r() < (spec.referralShare ?? 0)) {
      const email = customerEmail();
      refToken = token;
      sim.refs.push({
        program_id: sim.programId,
        affiliate_id: a.id,
        token,
        email,
        email_hash: hashEmail(email),
        customer_ref: customerRef,
        status: "converted",
        source: spec.source,
        sub_id: sub,
        created_at: iso(Math.min(orderTs, ts + 2 * MIN)),
        converted_at: iso(orderTs),
      });
    }
    const amount = spec.orderValue ? spec.orderValue(r) : 4900;
    const refunded = r() < spec.refundRate;
    addConversion({
      aff: a,
      refToken,
      externalId: "",
      customerRef,
      subscriptionRef: null,
      nth: 1,
      amount,
      commission: computeCommission({ settings, affiliateOverride: a.override, amountCents: amount }),
      occurred: orderTs,
      refundAt: refunded ? orderTs + (1 + r() * 11) * DAY : null,
      reason: refunded ? pick(r, spec.refundReasons) : null,
    });
  };

  for (let i = firstDay; i >= 0; i--) {
    const start = dayStart(nowMs - i * DAY);
    const day = dayOf(start);
    const t = 1 - i / (DAYS - 1);
    const base = spec.clicks[0] + (spec.clicks[1] - spec.clicks[0]) * Math.pow(t, 1.25);
    const spike = (spec.spikes ?? []).reduce((m, s) => (i <= s.from && i >= s.to ? m * s.mult : m), 1);
    const n = Math.round(base * spec.weekday[new Date(start).getUTCDay()] * spike * (0.85 + r() * 0.3));
    const eligible = sim.affs.filter(
      (a) => a.spec.weight > 0 && (a.spec.status ?? "approved") !== "pending" && a.spec.joined >= i && !(a.spec.blocked !== undefined && i <= a.spec.blocked),
    );
    if (!eligible.length || n <= 0) continue;
    const affW: W<AffState> = eligible.map((a) => [a, a.spec.weight * (a.spec.spikes ?? []).reduce((m, s) => (i <= s.from && i >= s.to ? m * s.mult : m), 1)] as const);

    if (i < RAW_DAYS) {
      const times = Array.from({ length: n }, () => start + timeOfDay(r)).sort((a, b) => a - b);
      const visitors = new Map<number, Visitor[]>();
      for (const ts of times) {
        if (ts > nowMs) break;
        const a = pickW(r, affW);
        const list = visitors.get(a.id) ?? [];
        let v: Visitor;
        let dup = 0;
        if (list.length && r() < DUP_RATE) {
          v = list[Math.floor(r() * list.length)];
          dup = 1;
        } else {
          v = newVisitor(a);
          list.push(v);
          visitors.set(a.id, list);
        }
        sim.clicks.push({
          program_id: sim.programId,
          affiliate_id: a.id,
          ts: iso(ts),
          token: v.token,
          landing_path: v.path,
          referrer_host: v.ref,
          visitor_hash: v.hash,
          country: v.country,
          device: v.device,
          sub_id: v.sub,
          is_duplicate: dup,
        });
        countMonth(ts);
        if (!dup) events(a, ts, v.token, v.sub);
      }
    } else {
      const per = new Map<AffState, { c: number; u: number }>();
      for (let k = 0; k < n; k++) {
        const a = pickW(r, affW);
        const cur = per.get(a) ?? { c: 0, u: 0 };
        const dup = cur.c > 0 && r() < DUP_RATE;
        cur.c += 1;
        if (!dup) {
          cur.u += 1;
          events(a, start + timeOfDay(r), rid(r, 24), a.spec.subs && r() < 0.7 ? pick(r, a.spec.subs) : "");
        }
        per.set(a, cur);
        countMonth(start + 12 * HOUR);
      }
      for (const [a, v] of per) sim.daily.push({ program_id: sim.programId, affiliate_id: a.id, day, clicks: v.c, unique_clicks: v.u });
    }
  }

  // A deal closed by hand (manual conversion with a note).
  if (spec.slug === "northwind" && sim.affs.length > 0) {
    const maya = sim.affs[0];
    const occurred = dayStart(nowMs - 41 * DAY) + 15 * HOUR + 12 * MIN;
    addConversion({
      aff: maya,
      refToken: null,
      externalId: "INV-2026-0142",
      customerRef: null,
      subscriptionRef: null,
      nth: 1,
      amount: 238_800,
      commission: computeCommission({ settings, affiliateOverride: maya.override, amountCents: 238_800 }),
      occurred,
      refundAt: null,
      reason: null,
      source: "manual",
      note: "Annual Scale plan for a 40-seat team, paid by invoice. Introduced by Maya on a call.",
    });
  }

  // Order numbers in date order.
  sim.convs.sort((a, b) => a.occurred - b.occurred);
  for (const c of sim.convs) {
    if (!c.externalId) c.externalId = spec.orderId ? spec.orderId(orderCounter++, r) : `ORD-${1000 + orderCounter++}`;
  }

  // Statuses by age: refunds reverse, blocked affiliates lose their open commissions,
  // conversions past the hold are approved, recent ones are pending.
  for (const c of sim.convs) {
    if (c.aff.blockedMs !== null) {
      c.status = "reversed";
      c.reversedAt = Math.max(c.aff.blockedMs, c.occurred + HOUR);
      c.reason = "Affiliate blocked: paid search on our brand name (terms section 4)";
    } else if (c.refundAt !== null && c.refundAt <= nowMs) {
      c.status = "reversed";
      c.reversedAt = c.refundAt;
    } else if (nowMs - c.occurred >= holdMs) {
      c.status = "approved";
      c.approvedAt = c.occurred + holdMs;
      c.reason = null;
    } else {
      c.status = "pending";
      c.reason = null;
    }
  }

  // Fraud flags on a few recent first payments, left pending for review.
  for (const f of spec.flags ?? []) {
    const candidates = sim.convs.filter((c) => c.status === "pending" && c.nth === 1 && !c.flags.length && c.source !== "manual");
    for (let k = 0; k < f.count && candidates.length; k++) {
      const c = candidates.splice(Math.floor(r() * candidates.length), 1)[0];
      c.flags = [f.flag];
      c.note = f.flag === "self_referral" ? "Customer email matches the affiliate's own email." : null;
    }
  }

  // Payout runs: approved commissions past the hold, per affiliate, when they meet the minimum.
  for (const [bi, b] of (spec.batches ?? []).entries()) {
    const created = dayStart(nowMs - b.daysAgo * DAY) + 9 * HOUR + Math.floor(r() * HOUR);
    const cutoff = created - holdMs;
    const batch: BatchDraft = { key: `${sim.programId}:${bi}`, paid: b.paid, created, paidAt: b.paid ? created + 26 * HOUR : null, note: b.note, payouts: [] };
    const byAff = new Map<AffState, ConvDraft[]>();
    for (const c of sim.convs) {
      if (c.status !== "approved" || c.payoutKey || c.occurred > cutoff || c.commission <= 0) continue;
      if ((c.aff.spec.status ?? "approved") !== "approved") continue;
      if (b.paid && !c.aff.hasDetails) continue;
      byAff.set(c.aff, [...(byAff.get(c.aff) ?? []), c]);
    }
    let seq = 1;
    for (const [aff, list] of byAff) {
      const amount = list.reduce((s, c) => s + c.commission, 0);
      if (amount < settings.minPayoutCents) continue;
      const key = `${batch.key}:${aff.id}`;
      const date = dayOf(created).replace(/-/g, "");
      const reference = b.paid ? (aff.method === "paypal" ? `PAYOUT-${rid(r, 13, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}` : `TRF-${date}-${String(seq++).padStart(3, "0")}`) : null;
      batch.payouts.push({ key, batchKey: batch.key, aff, amount, count: list.length, created, paidAt: batch.paidAt, reference });
      for (const c of list) {
        c.payoutKey = key;
        if (b.paid) {
          c.status = "paid";
          c.paidAt = batch.paidAt;
        }
      }
    }
    if (batch.payouts.length) sim.batches.push(batch);
  }
}

// ── Seeding ──

export interface DemoProgramCounts {
  programs: number;
  affiliates: number;
  clicks: number;
  clickDaily: number;
  referrals: number;
  conversions: number;
  payoutBatches: number;
  payouts: number;
  assets: number;
  usageRows: number;
}

async function insertChunks<T extends keyof Database & string>(db: Db, table: T, rows: Insertable<Database[T]>[], size: number): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + size) as never)
      .execute();
  }
}

async function putSetting(db: Db, key: string, value: string): Promise<void> {
  const exists = await db.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
  if (exists) {
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
    return;
  }
  try {
    await db.insertInto("settings").values({ key, value }).execute();
  } catch {
    // Another instance (e.g. a background job on a parallel request) created the row meanwhile.
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
  }
}

/**
 * Create the demo programs and their activity. `db` is usually the transaction of the demo
 * seed; `siteUrl` decides Northwind's domain (the platform's own host on a public demo, so
 * the tracker can be tried on the landing page); `rand` seeds the generator.
 */
export async function seedDemoPrograms(db: Db, options: { adminId: number; siteUrl: string; rand: Rand }): Promise<DemoProgramCounts> {
  const r = makeRand(Math.floor(options.rand() * 4294967296));
  const nowMs = Date.now();

  const admin = await db.selectFrom("users").select(["id", "email"]).where("id", "=", options.adminId).executeTakeFirstOrThrow();
  const owners = (
    await db.selectFrom("users").select("id").where("role", "=", "user").where("status", "=", "active").where("plan_id", "is not", null).orderBy("id").limit(3).execute()
  ).map((u) => u.id);
  const specs = [...adminPrograms(admin.id, isPublicHost(options.siteUrl) ?? "northwind.example"), ...customerPrograms(owners)];

  // Slugs are unique: keep an existing program's slug and use "<slug>-demo" for ours.
  const taken = new Set((await db.selectFrom("programs").select("slug").where("slug", "in", specs.map((s) => s.slug)).execute()).map((p) => p.slug));
  for (const s of specs) if (taken.has(s.slug)) s.slug = `${s.slug}-demo`;

  // Alert channel of the owner, used by both admin programs.
  const channelTs = iso(nowMs - 94 * DAY);
  await db
    .insertInto("alert_channels")
    .values({ user_id: admin.id, type: "email", name: "Owner inbox", config: JSON.stringify({ to: admin.email }), is_active: 1, created_at: channelTs, updated_at: channelTs })
    .execute();
  const channel = await db.selectFrom("alert_channels").select("id").where("user_id", "=", admin.id).where("name", "=", "Owner inbox").orderBy("id", "desc").executeTakeFirstOrThrow();

  // Programs.
  const programRows = specs.map((s) => {
    const created = nowMs - s.createdDaysAgo * DAY;
    const settings = normalizeProgramSettings({ ...s.settings, ...(s.ownerId === admin.id ? { alertChannelIds: [channel.id] } : {}) });
    return {
      user_id: s.ownerId,
      name: s.name,
      slug: s.slug,
      domain: s.domain,
      currency: s.currency,
      settings: JSON.stringify(settings),
      status: "active" as const,
      public_key: randomToken(12),
      webhook_token: randomToken(32),
      webhook_secret: null,
      verified_at: iso(created + 26 * HOUR),
      created_at: iso(created),
      updated_at: iso(created),
    };
  });
  await db.insertInto("programs").values(programRows).execute();
  const programIds = new Map((await db.selectFrom("programs").select(["id", "slug"]).where("slug", "in", specs.map((s) => s.slug)).execute()).map((p) => [p.slug, p.id]));

  // Affiliates.
  const login = demoAffiliateLogin();
  const demoHash = await hashPassword(login.password);
  const affiliateRows: Array<Insertable<Database["affiliates"]>> = [];
  const affMeta: Array<{ programId: number; email: string; spec: AffSpec; method: PayoutMethod; details: PayoutDetails; hasDetails: boolean; override: CommissionOverride | null }> = [];
  for (const s of specs) {
    const programId = programIds.get(s.slug)!;
    const settings = normalizeProgramSettings(s.settings);
    const codes = new Set<string>();
    for (const a of s.affiliates) {
      const [firstName, ...rest] = ascii(a.name).split(" ");
      const lastName = rest.join("").replace(/[^A-Za-z]/g, "");
      const email = a.demo ? login.email : a.website ? `${firstName.toLowerCase()}@${a.website}` : `${firstName}.${lastName}@gmail.com`.toLowerCase();
      let code = a.code ?? firstName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (codes.has(code)) code = `${code}${lastName.toLowerCase().slice(0, 1)}`;
      codes.add(code);
      const method: PayoutMethod = a.method && settings.payoutMethods.includes(a.method) ? a.method : "paypal";
      const details: PayoutDetails = a.noDetails ? {} : method === "bank" ? bankDetails(r, ascii(a.name), a.country ?? "DE") : { paypalEmail: a.demo ? login.email : r() < 0.7 ? email : `${firstName.toLowerCase()}.payments@gmail.com` };
      const status = a.status ?? "approved";
      const created = nowMs - a.joined * DAY - Math.floor(r() * 10 * HOUR);
      const approvedAt = status === "pending" ? null : settings.autoApprove ? created : created + (4 + r() * 30) * HOUR;
      const lastLogin = a.demo ? nowMs - 3 * HOUR - Math.floor(r() * HOUR) : a.invited || status === "pending" ? null : nowMs - Math.floor(r() * Math.min(a.joined, 20) * DAY) - HOUR;
      affiliateRows.push({
        program_id: programId,
        email,
        name: a.name,
        password_hash: a.demo ? demoHash : a.invited ? null : "disabled",
        status,
        code,
        coupon_code: a.coupon ?? null,
        commission_override: a.override ? JSON.stringify(a.override) : null,
        payout_method: method,
        payout_details: JSON.stringify(details),
        website: a.website ? `https://${a.website}` : null,
        notes: a.notes ?? null,
        last_visitor_hash: null,
        approved_at: approvedAt === null ? null : iso(Math.min(approvedAt, nowMs)),
        last_login_at: lastLogin === null ? null : iso(Math.max(lastLogin, created + HOUR)),
        created_at: iso(created),
        updated_at: iso(a.blocked !== undefined ? nowMs - a.blocked * DAY : created),
      });
      affMeta.push({ programId, email, spec: a, method, details, hasDetails: method === "paypal" ? Boolean(details.paypalEmail) : Boolean(details.accountNumber), override: a.override ?? null });
    }
  }
  const affOrder = affiliateRows.map((row, i) => ({ row, meta: affMeta[i] })).sort((a, b) => String(a.row.created_at).localeCompare(String(b.row.created_at)));
  await insertChunks(db, "affiliates", affOrder.map((x) => x.row), ROW_CHUNK);
  const affIds = new Map(
    (await db.selectFrom("affiliates").select(["id", "program_id", "email"]).where("program_id", "in", [...programIds.values()]).execute()).map((a) => [`${a.program_id}:${a.email}`, a.id]),
  );

  // Activity.
  const emails = new Set<string>();
  const sims: Sim[] = specs.map((s) => {
    const programId = programIds.get(s.slug)!;
    return {
      spec: s,
      programId,
      settings: normalizeProgramSettings(s.settings),
      affs: affMeta
        .filter((m) => m.programId === programId)
        .map((m) => ({
          spec: m.spec,
          id: affIds.get(`${programId}:${m.email}`)!,
          email: m.email,
          override: m.override,
          method: m.method,
          details: m.details,
          hasDetails: m.hasDetails,
          blockedMs: m.spec.blocked !== undefined ? dayStart(nowMs - m.spec.blocked * DAY) + 11 * HOUR : null,
        })),
      clicks: [],
      daily: [],
      refs: [],
      convs: [],
      batches: [],
      clicksByMonth: new Map(),
    };
  });
  for (const sim of sims) simulate(sim, r, nowMs, emails);

  // Referrals (needed for conversions.referral_id).
  const refs = sims.flatMap((s) => s.refs).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  await insertChunks(db, "referrals", refs, ROW_CHUNK);
  const refIds = new Map(
    (await db.selectFrom("referrals").select(["id", "program_id", "token"]).where("program_id", "in", [...programIds.values()]).execute()).map((x) => [`${x.program_id}:${x.token}`, x.id]),
  );

  // Payout batches and payouts.
  const batchDrafts = sims.flatMap((s) => s.batches.map((b) => ({ sim: s, b }))).sort((x, y) => x.b.created - y.b.created);
  const batchRows: Insertable<PayoutBatchesTable>[] = batchDrafts.map(({ sim, b }) => ({
    program_id: sim.programId,
    status: b.paid ? "paid" : "draft",
    currency: sim.spec.currency,
    total_cents: b.payouts.reduce((s, p) => s + p.amount, 0),
    payout_count: b.payouts.length,
    note: b.note,
    created_at: iso(b.created),
    paid_at: b.paidAt ? iso(b.paidAt) : null,
  }));
  if (batchRows.length) await insertChunks(db, "payout_batches", batchRows, ROW_CHUNK);
  const batchIds = new Map(
    (await db.selectFrom("payout_batches").select(["id", "program_id", "created_at"]).where("program_id", "in", [...programIds.values()]).execute()).map((b) => [`${b.program_id}:${b.created_at}`, b.id]),
  );
  const payoutRows: Insertable<PayoutsTable>[] = [];
  for (const { sim, b } of batchDrafts) {
    const batchId = batchIds.get(`${sim.programId}:${iso(b.created)}`)!;
    for (const p of b.payouts) {
      payoutRows.push({
        program_id: sim.programId,
        affiliate_id: p.aff.id,
        batch_id: batchId,
        amount_cents: p.amount,
        currency: sim.spec.currency,
        method: p.aff.method,
        details: JSON.stringify(p.aff.details),
        status: b.paid ? "paid" : "draft",
        reference: p.reference,
        conversion_count: p.count,
        created_at: iso(p.created),
        paid_at: p.paidAt ? iso(p.paidAt) : null,
      });
    }
  }
  if (payoutRows.length) await insertChunks(db, "payouts", payoutRows, ROW_CHUNK);
  const payoutIds = new Map(
    (await db.selectFrom("payouts").select(["id", "program_id", "affiliate_id", "batch_id"]).where("program_id", "in", [...programIds.values()]).execute()).map((p) => [`${p.program_id}:${p.batch_id}:${p.affiliate_id}`, p.id]),
  );
  const payoutKeyToId = new Map<string, number>();
  for (const { sim, b } of batchDrafts) {
    const batchId = batchIds.get(`${sim.programId}:${iso(b.created)}`)!;
    for (const p of b.payouts) payoutKeyToId.set(p.key, payoutIds.get(`${sim.programId}:${batchId}:${p.aff.id}`)!);
  }

  // Conversions.
  const conversionRows: Insertable<ConversionsTable>[] = sims
    .flatMap((s) => s.convs.map((c) => ({ s, c })))
    .sort((x, y) => x.c.occurred - y.c.occurred)
    .map(({ s, c }) => {
      const recorded = Math.min(c.occurred + 2 * MIN, nowMs);
      const updated = Math.max(recorded, c.paidAt ?? 0, c.reversedAt ?? 0, c.approvedAt ?? 0);
      return {
        program_id: s.programId,
        affiliate_id: c.aff.id,
        referral_id: c.refToken ? (refIds.get(`${s.programId}:${c.refToken}`) ?? null) : null,
        source: c.source,
        external_id: c.externalId,
        customer_ref: c.customerRef,
        subscription_ref: c.subscriptionRef,
        nth: c.nth,
        amount_cents: c.amount,
        currency: s.spec.currency,
        commission_cents: c.commission,
        status: c.status,
        flags: c.flags.join(","),
        payout_id: c.payoutKey ? (payoutKeyToId.get(c.payoutKey) ?? null) : null,
        occurred_at: iso(c.occurred),
        approved_at: c.approvedAt !== null && c.status !== "reversed" ? iso(c.approvedAt) : null,
        paid_at: c.paidAt !== null ? iso(c.paidAt) : null,
        reversed_at: c.reversedAt !== null ? iso(c.reversedAt) : null,
        reversal_reason: c.status === "reversed" ? c.reason : null,
        note: c.note,
        created_at: iso(recorded),
        updated_at: iso(Math.min(updated, nowMs)),
      };
    });
  await insertChunks(db, "conversions", conversionRows, ROW_CHUNK);

  // Clicks: raw rows for the recent days, daily summaries before them.
  const clickRows = sims.flatMap((s) => s.clicks).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  await insertChunks(db, "clicks", clickRows, CLICK_CHUNK);
  const dailyRows = sims.flatMap((s) => s.daily);
  await insertChunks(db, "click_daily", dailyRows, DAILY_CHUNK);

  // Marketing assets.
  const assetRows: Insertable<AssetsTable>[] = sims.flatMap((s) =>
    s.spec.assets.map((a, i) => {
      const created = iso(nowMs - (s.spec.createdDaysAgo - 1) * DAY + i * MIN);
      return { program_id: s.programId, type: a.type, title: a.title, url: a.url ?? "", image: a.image ?? null, content: a.content ?? null, is_active: 1, sort_order: i + 1, created_at: created, updated_at: created };
    }),
  );
  await insertChunks(db, "assets", assetRows, ROW_CHUNK);

  // Monthly usage (conversions are counted when recorded, clicks when tracked).
  const usage = new Map<string, { user_id: number; month: string; conversions: number; clicks: number }>();
  const bump = (userId: number, month: string, field: "conversions" | "clicks", n: number) => {
    const key = `${userId}:${month}`;
    const row = usage.get(key) ?? { user_id: userId, month, conversions: 0, clicks: 0 };
    row[field] += n;
    usage.set(key, row);
  };
  for (const s of sims) {
    for (const c of s.convs) bump(s.spec.ownerId, iso(c.occurred).slice(0, 7), "conversions", 1);
    for (const [month, n] of s.clicksByMonth) bump(s.spec.ownerId, month, "clicks", n);
  }
  const usageRows = [...usage.values()];
  const existingUsage = await db
    .selectFrom("usage_monthly")
    .select(["user_id", "month"])
    .where("user_id", "in", [...new Set(usageRows.map((u) => u.user_id))])
    .execute();
  const have = new Set(existingUsage.map((u) => `${u.user_id}:${u.month}`));
  for (const u of usageRows.filter((x) => have.has(`${x.user_id}:${x.month}`))) {
    await db.updateTable("usage_monthly").set({ conversions: u.conversions, clicks: u.clicks }).where("user_id", "=", u.user_id).where("month", "=", u.month).execute();
  }
  await insertChunks(db, "usage_monthly", usageRows.filter((x) => !have.has(`${x.user_id}:${x.month}`)), ROW_CHUNK);

  // Click summaries cover every day up to (and including) the day before the raw clicks; the
  // click-rollups job continues from there. The highest click id tells it nothing arrived late.
  const maxClick = await db.selectFrom("clicks").select((eb) => eb.fn.max("id").as("id")).executeTakeFirst();
  await putSetting(db, "click_rollup_until", dayOf(nowMs - RAW_DAYS * DAY));
  await putSetting(db, "click_rollup_max_id", String(Number(maxClick?.id ?? 0)));
  await putSetting(db, "showcase_program_slug", specs[0].slug);

  return {
    programs: specs.length,
    affiliates: affiliateRows.length,
    clicks: clickRows.length,
    clickDaily: dailyRows.length,
    referrals: refs.length,
    conversions: conversionRows.length,
    payoutBatches: batchRows.length,
    payouts: payoutRows.length,
    assets: assetRows.length,
    usageRows: usageRows.length,
  };
}
