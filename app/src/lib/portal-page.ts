import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { AffiliateRecord } from "./affiliates";
import type { Translator } from "./i18n/messages";
import { getLocale, getT } from "./i18n/server";
import { getEntitlementsForUserId } from "./plans";
import { getPortalAffiliate, getPortalProgram } from "./portal-session";
import { getProgramAvailability, type ProgramAvailability, type ProgramRecord } from "./programs";
import { requestVisitorHash } from "./salts";
import { headers } from "next/headers";
import { getDb } from "./db";
import { formatMoney, referralLink } from "@/referral/normalize";

/** Shared loaders and formatters of the affiliate portal pages (/a/<slug>/…). */

export interface PortalContext {
  program: ProgramRecord;
  affiliate: AffiliateRecord | null;
  t: Translator;
  locale: string;
  dir: "ltr" | "rtl";
  /** The owner's plan hides the "Powered by" line. */
  removeBranding: boolean;
  /** "paused" by the merchant / administrator, "unavailable" when the owner's account is banned: no sign-ups or tracking. */
  availability: ProgramAvailability;
}

export const loadPortal = cache(async (slug: string): Promise<PortalContext> => {
  const program = await getPortalProgram(slug);
  if (!program) notFound();
  const [affiliate, t, locale, entitlements, availability] = await Promise.all([
    getPortalAffiliate(program.id),
    getT(),
    getLocale(),
    getEntitlementsForUserId(program.userId),
    getProgramAvailability(program),
  ]);
  return { program, affiliate, t, locale: locale.code, dir: locale.dir, removeBranding: entitlements.removeBranding, availability };
});

/**
 * For signed-in pages: the program and its signed-in affiliate, or a redirect to the login
 * page. Also refreshes the affiliate's visitor hash once per day and browser (fraud check).
 */
export async function requireAffiliate(slug: string): Promise<PortalContext & { affiliate: AffiliateRecord }> {
  const ctx = await loadPortal(slug);
  if (!ctx.affiliate) redirect(`/a/${slug}/login`);
  await refreshVisitorHash(ctx.program.id, ctx.affiliate);
  return ctx as PortalContext & { affiliate: AffiliateRecord };
}

async function refreshVisitorHash(programId: number, affiliate: AffiliateRecord): Promise<void> {
  try {
    const hash = await requestVisitorHash(programId, await headers());
    if (hash === affiliate.lastVisitorHash) return;
    const db = await getDb();
    await db.updateTable("affiliates").set({ last_visitor_hash: hash }).where("id", "=", affiliate.id).execute();
  } catch {
    // Not essential for the page.
  }
}

export const fmtMoney = (cents: number, currency: string, locale: string) => formatMoney(cents, currency, locale);

export function fmtNumber(n: number, locale: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return n.toLocaleString("en");
  }
}

export function fmtDate(iso: string | null | undefined, locale: string, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) };
  try {
    return d.toLocaleDateString(locale, options);
  } catch {
    return d.toLocaleDateString("en", options);
  }
}

/** "25%" or "$10.00" */
export function rateText(program: Pick<ProgramRecord, "currency" | "settings">, locale: string): string {
  const s = program.settings;
  if (s.commissionType === "percent") {
    const value = s.rate / 100;
    try {
      return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(value / 100);
    } catch {
      return `${value}%`;
    }
  }
  return fmtMoney(s.rate, program.currency, locale);
}

/** Headline of the commission: "25% commission on every sale" etc. */
export function commissionHeadline(program: Pick<ProgramRecord, "currency" | "settings">, t: Translator, locale: string): string {
  const rate = rateText(program, locale);
  return program.settings.commissionType === "percent" ? t("portal.rate.percent", { rate }) : t("portal.rate.fixed", { rate });
}

export function recurringText(program: Pick<ProgramRecord, "settings">, t: Translator): string {
  const r = program.settings.recurring;
  if (r.mode === "lifetime") return t("portal.recurring.lifetime");
  if (r.mode === "months") return r.months === 1 ? t("portal.recurring.monthsOne") : t("portal.recurring.monthsOther", { n: r.months });
  return t("portal.recurring.none");
}

/** The affiliate's default referral link (home page of the merchant site). */
export function defaultLink(program: Pick<ProgramRecord, "domain" | "settings">, code: string, path = "", subId = ""): string {
  return referralLink(program.domain, code, { param: program.settings.refParams[0], path, subId });
}
