import { plural, type Translator } from "@/lib/i18n/messages";
import { currencyDecimals, formatCurrency, formatMoney, fromMinorUnits } from "@/referral/normalize";
import type { ProgramSettings } from "@/referral/types";

/** Money for the landing illustrations (minor units → localized string; whole amounts without decimals). */
export function money(cents: number, currency: string, locale: string): string {
  const value = fromMinorUnits(cents, currency);
  const digits = Number.isInteger(value) ? 0 : currencyDecimals(currency);
  try {
    return formatCurrency(value, currency, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return formatMoney(cents, currency, locale);
  }
}

/** 0.3 → "30%" in the visitor's locale. */
export function pct(fraction: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(fraction);
  } catch {
    return `${Math.round(fraction * 100)}%`;
  }
}

export function num(n: number, locale: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return n.toLocaleString("en");
  }
}

/** A program's default commission in one translated phrase ("30% recurring for 12 months"). */
export function rateLabel(settings: Pick<ProgramSettings, "commissionType" | "rate" | "recurring">, currency: string, t: Translator, locale: string): string {
  const rate = settings.commissionType === "percent" ? pct(settings.rate / 10000, locale) : money(settings.rate, currency, locale);
  if (settings.recurring.mode === "months") return plural(t, "home.rate.months", settings.recurring.months, { rate });
  if (settings.recurring.mode === "lifetime") return t("home.rate.lifetime", { rate });
  return t("home.rate.once", { rate });
}

/** Two-letter initials for the example avatars. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Example affiliates shared by the hero and the portal illustration. */
export const EXAMPLE_AFFILIATES = [
  { name: "Maya Chen", sales: 48, earned: 117600, tone: "from-pink-500 to-rose-600" },
  { name: "Jonas Weber", sales: 36, earned: 88200, tone: "from-amber-400 to-orange-500" },
  { name: "Priya Nair", sales: 29, earned: 71000, tone: "from-violet-500 to-fuchsia-500" },
  { name: "Lucas Martin", sales: 21, earned: 51400, tone: "from-sky-500 to-indigo-500" },
] as const;
