/**
 * Turns untrusted input (dashboard and portal forms, stored JSON, webhooks, tracker payloads)
 * into valid values, and computes commissions. Unknown keys are dropped, missing keys get
 * defaults. Dependency-free (server, client components and tests).
 */

import {
  AFFILIATE_STATUSES,
  CHANNEL_TYPES,
  COMMISSION_TYPES,
  CONVERSION_FLAGS,
  CONVERSION_SOURCES,
  CONVERSION_STATUSES,
  DEFAULT_PROGRAM_SETTINGS,
  LEAD_EMAIL_MODES,
  NOTIFY_EVENTS,
  PAYOUT_METHODS,
  RECURRING_MODES,
  type AffiliateStatus,
  type ChannelConfigByType,
  type ChannelType,
  type CommissionOverride,
  type CommissionType,
  type ConversionFlag,
  type ConversionSource,
  type ConversionStatus,
  type PayoutDetails,
  type PayoutMethod,
  type ProgramSettings,
} from "./types";

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;

export function parseJson(text: string | null | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Trimmed string without control characters, at most `max` characters. */
export function str(v: unknown, fallback = "", max = 500): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, max);
  if (typeof v !== "string") return fallback;
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

/** Like str() but keeps line breaks (terms, notes). */
export function text(v: unknown, max = 20_000): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

export function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on" || v === 1 || v === "1") return true;
  if (v === "false" || v === "off" || v === 0 || v === "0") return false;
  return fallback;
}

/** Integer clamped to [min, max]; `fallback` when not a number. */
export function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function list(v: unknown, max: number, each: (s: string) => string): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]+/) : [];
  return [...new Set(raw.map((x) => each(String(x))).filter(Boolean))].slice(0, max);
}

// ── Identifiers ──

/** "https://WWW.Example.com/path" → "example.com"; "" when invalid. Keeps subdomains other than www. */
export function normalizeDomain(v: unknown): string {
  if (typeof v !== "string") return "";
  let value = v.trim().toLowerCase();
  if (!value) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  try {
    const host = new URL(value).hostname.replace(/\.$/, "").replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(host) && host !== "localhost") return "";
    return host;
  } catch {
    return "";
  }
}

/** True when `host` is `domain`, www.`domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  if (!domain) return false;
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}

/** Paths under /a/ that are portal pages, so they can't be program slugs. */
export const RESERVED_SLUGS = ["login", "signup", "register", "logout", "forgot", "reset", "dashboard", "api", "admin", "new", "settings", "assets", "payouts"];

/**
 * Portal slug (/a/<slug>): lowercase letters, digits and single dashes, 3–40 characters.
 * "Acme Store!" → "acme-store". Returns "" when nothing usable is left.
 */
export function normalizeSlug(v: unknown): string {
  const s = str(v, "", 200)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : "";
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}

/**
 * Referral code (?ref=CODE): letters, digits, "-" and "_", 3–32 characters, stored lowercase
 * so links are case-insensitive. "Jane Doe" → "jane-doe". "" when invalid.
 */
export function normalizeCode(v: unknown): string {
  const s = str(v, "", 100)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 32);
  return s.length >= 3 ? s : "";
}

/** Query parameter name for referral codes ("ref", "via", "aff"…): 1–20 letters, digits, "_" or "-". */
export function normalizeParamName(v: unknown): string {
  const s = str(v, "", 40).toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(s) ? s : "";
}

/** Lowercase email or "" when it doesn't look like one. */
export function normalizeEmail(v: unknown): string {
  const s = str(v, "", 190).toLowerCase();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(s) ? s : "";
}

/** ISO 4217 code ("usd" → "USD") or `fallback`. */
export function normalizeCurrency(v: unknown, fallback = "USD"): string {
  const s = str(v, "", 3).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : fallback;
}

/** #rrggbb (or "" when invalid). "#abc" is expanded. */
export function normalizeColor(v: unknown): string {
  const s = str(v, "", 7).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return "";
}

/** http(s) URL or "". */
export function httpUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  const value = v.trim().slice(0, 1000);
  return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : "";
}

/** Campaign / sub id of a link (?sub=…): up to 60 printable characters. */
export function normalizeSubId(v: unknown): string {
  return str(v, "", 60).replace(/[^A-Za-z0-9 _.:/-]/g, "");
}

/**
 * An affiliate's referral link: https://<domain><path>?<param>=<code>[&sub=<subId>].
 * `path` may be a page path ("/pricing") or a full URL on the merchant site (its query is kept).
 */
export function referralLink(domain: string, code: string, options: { param?: string; path?: string; subId?: string } = {}): string {
  const param = normalizeParamName(options.param) || "ref";
  let url: URL;
  try {
    const raw = (options.path ?? "").trim();
    url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw.startsWith("/") ? raw : `/${raw}`, `https://${domain || "example.com"}`);
  } catch {
    url = new URL(`https://${domain || "example.com"}/`);
  }
  url.hash = "";
  url.searchParams.set(param, code);
  const sub = normalizeSubId(options.subId);
  if (sub) url.searchParams.set("sub", sub);
  return url.toString();
}

// ── Money ──

/** Currencies without minor units (Stripe's list). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
/** Currencies with three decimals. */
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** 19.99 USD → 1999; "1,234.50" → 123450; NaN/negative → 0. */
export function toMinorUnits(amount: unknown, currency: string): number {
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount.replace(/[\s,]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 10 ** currencyDecimals(currency)), 1e13);
}

/** 1999 USD → 19.99 */
export function fromMinorUnits(cents: number, currency: string): number {
  const d = currencyDecimals(currency);
  return Math.round(cents) / 10 ** d;
}

const plainSymbols = new Map<string, string>();

/**
 * The sign English shows for a currency when it is a plain, unambiguous sign ($, €, £, ¥, ₹ …),
 * else "". CA$, A$ or CN¥ stay as they are, and so do letter codes (AED), which other
 * languages may write in their own script.
 */
function plainSymbol(currency: string): string {
  const code = currency.toUpperCase();
  let symbol = plainSymbols.get(code);
  if (symbol === undefined) {
    try {
      const sign = (currencyDisplay: "narrowSymbol" | "symbol") =>
        new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay }).formatToParts(1).find((p) => p.type === "currency")?.value ?? "";
      const narrow = sign("narrowSymbol");
      symbol = narrow === sign("symbol") && !/[A-Za-z]/.test(narrow) ? narrow : "";
    } catch {
      symbol = "";
    }
    plainSymbols.set(code, symbol);
  }
  return symbol;
}

/**
 * Intl currency formatting in the reader's language with the plain sign where there is one:
 * some languages spell even common signs out ("US$" in Arabic, "$US" in French), which reads
 * oddly next to a single-currency program. Throws like Intl.NumberFormat on an unknown currency.
 */
export function formatCurrency(value: number, currency: string, locale: string, options: Intl.NumberFormatOptions = {}): string {
  const symbol = plainSymbol(currency);
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency, ...(symbol ? { currencyDisplay: "narrowSymbol" } : {}), ...options });
  if (!symbol) return nf.format(value);
  return nf
    .formatToParts(value)
    .map((p) => (p.type === "currency" ? symbol : p.value))
    .join("");
}

/** "$19.99" in the reader's language; dependency-free. */
export function formatMoney(cents: number, currency: string, locale = "en"): string {
  const value = fromMinorUnits(cents, currency);
  const digits = currencyDecimals(currency);
  try {
    return formatCurrency(value, currency, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** Commission rate as text: "25%" or "$10.00 per sale" (English; the UI translates its own). */
export function describeRate(type: CommissionType, rate: number, currency: string): string {
  return type === "percent" ? `${rate / 100}%` : `${formatMoney(rate, currency)} per sale`;
}

// ── Program settings ──

export function normalizeProgramSettings(input: unknown): ProgramSettings {
  const o = asObj(input);
  const d = DEFAULT_PROGRAM_SETTINGS;
  const commissionType = oneOf(COMMISSION_TYPES, o.commissionType, d.commissionType);
  const recurring = asObj(o.recurring);
  const payoutMethods = list(o.payoutMethods, PAYOUT_METHODS.length, (s) => oneOf(PAYOUT_METHODS, s.trim(), "" as PayoutMethod)) as PayoutMethod[];
  const refParams = list(o.refParams, 5, normalizeParamName);
  return {
    commissionType,
    rate: normalizeRate(commissionType, o.rate, commissionType === d.commissionType ? d.rate : 1000),
    recurring: {
      mode: oneOf(RECURRING_MODES, recurring.mode, d.recurring.mode),
      months: int(recurring.months, d.recurring.months, 1, 120),
    },
    cookieDays: int(o.cookieDays, d.cookieDays, 1, 365),
    holdDays: int(o.holdDays, d.holdDays, 0, 365),
    minPayoutCents: int(o.minPayoutCents, d.minPayoutCents, 0, 100_000_000),
    payoutMethods: payoutMethods.length ? payoutMethods : [...d.payoutMethods],
    autoApprove: bool(o.autoApprove, d.autoApprove),
    terms: text(o.terms, 20_000),
    portalHeadline: str(o.portalHeadline, "", 120),
    portalIntro: text(o.portalIntro, 1000),
    brandColor: normalizeColor(o.brandColor),
    logo: str(o.logo, "", 500),
    refParams: refParams.length ? refParams : [...d.refParams],
    extraDomains: list(o.extraDomains, 20, normalizeDomain),
    allowLocalhost: bool(o.allowLocalhost, d.allowLocalhost),
    leadEmailMode: oneOf(LEAD_EMAIL_MODES, o.leadEmailMode, d.leadEmailMode),
    allowClientConversions: bool(o.allowClientConversions, d.allowClientConversions),
    alertChannelIds: [...new Set((Array.isArray(o.alertChannelIds) ? o.alertChannelIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20),
    notifyEvents: Array.isArray(o.notifyEvents)
      ? [...new Set(o.notifyEvents.filter((e): e is ProgramSettings["notifyEvents"][number] => (NOTIFY_EVENTS as readonly unknown[]).includes(e)))]
      : [...d.notifyEvents],
    emailAffiliates: bool(o.emailAffiliates, d.emailAffiliates),
  };
}

/** Percent: basis points 1–10000 (100 %); fixed: minor units 1–100,000,000. */
export function normalizeRate(type: CommissionType, v: unknown, fallback: number): number {
  return type === "percent" ? int(v, fallback, 0, 10_000) : int(v, fallback, 0, 100_000_000);
}

/**
 * affiliates.commission_override JSON → override, or null when it sets no rate. The rate is
 * read in the override's type when given, otherwise in the program's type (computeCommission).
 */
export function normalizeCommissionOverride(input: unknown): CommissionOverride | null {
  const o = asObj(input);
  if (o.rate === undefined || o.rate === null || o.rate === "") return null;
  const type = typeof o.commissionType === "string" && (COMMISSION_TYPES as readonly string[]).includes(o.commissionType) ? (o.commissionType as CommissionType) : undefined;
  const rate = normalizeRate(type ?? "fixed", o.rate, NaN);
  if (!Number.isFinite(rate)) return null;
  return type ? { commissionType: type, rate } : { rate };
}

export function normalizePayoutDetails(method: PayoutMethod, input: unknown): PayoutDetails {
  const o = asObj(input);
  switch (method) {
    case "paypal":
      return { paypalEmail: normalizeEmail(o.paypalEmail) };
    case "bank":
      return {
        accountName: str(o.accountName, "", 120),
        accountNumber: str(o.accountNumber, "", 60).replace(/[^A-Za-z0-9 -]/g, ""),
        bankCode: str(o.bankCode, "", 40).replace(/[^A-Za-z0-9 -]/g, ""),
        bankName: str(o.bankName, "", 120),
        country: str(o.country, "", 60),
      };
    default:
      return { note: text(o.note, 500) };
  }
}

export function isPayoutMethod(v: unknown): v is PayoutMethod {
  return typeof v === "string" && (PAYOUT_METHODS as readonly string[]).includes(v);
}

export function isAffiliateStatus(v: unknown): v is AffiliateStatus {
  return typeof v === "string" && (AFFILIATE_STATUSES as readonly string[]).includes(v);
}

export function isConversionStatus(v: unknown): v is ConversionStatus {
  return typeof v === "string" && (CONVERSION_STATUSES as readonly string[]).includes(v);
}

export function isConversionSource(v: unknown): v is ConversionSource {
  return typeof v === "string" && (CONVERSION_SOURCES as readonly string[]).includes(v);
}

/** "self_referral,client_side" ↔ ["self_referral", "client_side"] (unknown flags dropped). */
export function parseFlags(v: string | null | undefined): ConversionFlag[] {
  if (!v) return [];
  return [...new Set(v.split(",").map((s) => s.trim()).filter((s): s is ConversionFlag => (CONVERSION_FLAGS as readonly string[]).includes(s)))];
}

export function serializeFlags(flags: readonly ConversionFlag[]): string {
  return [...new Set(flags)].join(",");
}

// ── Commission ──

export interface CommissionInput {
  settings: Pick<ProgramSettings, "commissionType" | "rate" | "recurring">;
  /** Per-affiliate override (type and/or rate). */
  affiliateOverride?: CommissionOverride | null;
  /** Order / payment amount in minor units. */
  amountCents: number;
  /** 1 = the customer's first payment, 2 = first renewal, … (default 1). */
  nth?: number;
  /**
   * Whole months between the customer's first commissioned payment and this one. When given,
   * "months" mode compares it with the limit (payments in months 0…N-1 earn); otherwise `nth`
   * is used (the first N payments earn).
   */
  monthsSinceFirst?: number;
}

/** True when a payment is still inside the program's recurring window. */
export function withinRecurringLimit(rule: ProgramSettings["recurring"], nth = 1, monthsSinceFirst?: number): boolean {
  if (nth <= 1 && !(monthsSinceFirst && monthsSinceFirst > 0)) return true;
  switch (rule.mode) {
    case "none":
      return false;
    case "lifetime":
      return true;
    case "months":
      return monthsSinceFirst !== undefined ? monthsSinceFirst < rule.months : nth <= rule.months;
  }
}

/**
 * Commission in minor units for one payment:
 * - percent: amount × rate / 10000, rounded half up
 * - fixed: the rate per conversion (whatever the amount)
 * - recurring: payments after the first earn only inside the recurring window, else 0
 * The affiliate's override replaces the program's rate (and type, when it sets one).
 */
export function computeCommission({ settings, affiliateOverride, amountCents, nth = 1, monthsSinceFirst }: CommissionInput): number {
  const amount = Number.isFinite(amountCents) && amountCents > 0 ? Math.round(amountCents) : 0;
  if (!withinRecurringLimit(settings.recurring, Math.max(1, Math.floor(nth)), monthsSinceFirst)) return 0;
  const type = affiliateOverride?.commissionType ?? settings.commissionType;
  const rate = Math.max(0, Math.round(affiliateOverride?.rate ?? settings.rate));
  if (type === "percent") return Math.floor((amount * Math.min(rate, 10_000) + 5_000) / 10_000);
  return rate;
}

// ── Alert channels ──

export function isChannelType(v: unknown): v is ChannelType {
  return typeof v === "string" && (CHANNEL_TYPES as readonly string[]).includes(v);
}

export function normalizeChannelConfig<T extends ChannelType>(type: T, input: unknown): ChannelConfigByType[T] {
  const o = asObj(input);
  let out: unknown;
  switch (type) {
    case "email":
      out = {
        to: str(o.to, "", 1000)
          .split(/[,;\s]+/)
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
          .slice(0, 10)
          .join(", "),
      };
      break;
    case "webhook":
      out = { url: httpUrl(o.url), secret: str(o.secret, "", 200) };
      break;
    case "slack":
    case "discord":
    case "teams":
      out = { webhookUrl: httpUrl(o.webhookUrl) };
      break;
    case "telegram":
      out = { botToken: str(o.botToken, "", 100).replace(/[^A-Za-z0-9:_-]/g, ""), chatId: str(o.chatId, "", 40).replace(/[^0-9@A-Za-z_-]/g, "") };
      break;
  }
  return out as ChannelConfigByType[T];
}

export function channelProblem(type: ChannelType, config: unknown): string {
  const c = asObj(config);
  if (type === "email" && !c.to) return "Enter at least one valid email address.";
  if (type === "webhook" && !c.url) return "Enter the webhook URL (https://…).";
  if ((type === "slack" || type === "discord" || type === "teams") && !c.webhookUrl) return "Paste the incoming webhook URL.";
  if (type === "telegram" && (!c.botToken || !c.chatId)) return "Enter the bot token and the chat ID.";
  return "";
}
