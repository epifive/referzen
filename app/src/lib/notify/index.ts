import "server-only";
import { buildAlertPayload, notifyChannels } from "@/lib/alerts";
import { alertPlainText, describeAlert } from "@/lib/alerts/format";
import type { AffiliateRecord } from "@/lib/affiliates";
import type { ConversionRecord } from "@/lib/conversions";
import { getDb } from "@/lib/db";
import { interpolate, type MessageKey, MESSAGES, plural, type Translator } from "@/lib/i18n/messages";
import { getDictionary } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import type { PayoutRecord } from "@/lib/payouts";
import { getEntitlementsForUserId } from "@/lib/plans";
import type { ProgramRecord } from "@/lib/programs";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatMoney, referralLink } from "@/referral/normalize";
import type { AlertEvent, NotifyEvent } from "@/referral/types";

/**
 * Notification emails of the referral programs, shared by the affiliate portal, the merchant
 * dashboard, the ingest routes and the background jobs. Every function here never throws:
 * a failed email or alert is logged on the server and the caller carries on.
 *
 * - Affiliate emails (welcome, approval, invitation, password reset, new commission, reversal,
 *   payout) are written in the platform's default language (Admin → Languages) and need SMTP.
 *   Commission / reversal / payout emails respect the program setting `emailAffiliates`;
 *   account emails (welcome, approval, invitation, reset) are always sent.
 * - Merchant notifications (new affiliate, new conversion, reversal, payout paid) go to the
 *   program's alert channels for the events selected in its settings (`notifyEvents`). When the
 *   program has no alert channel, the owner gets the same notification by email instead.
 */

type ProgramLike = Pick<ProgramRecord, "id" | "userId" | "name" | "slug" | "domain" | "currency" | "settings">;
type AffiliateLike = Pick<AffiliateRecord, "id" | "name" | "email" | "code" | "status"> & { hasPassword?: boolean };

/** The interface translator for emails: the platform's default language, English fallback. */
export async function emailTranslator(): Promise<{ t: Translator; locale: string }> {
  const settings = await getSettings();
  const locale = settings.default_language || "en";
  let dictionary: Record<string, string> = {};
  try {
    dictionary = await getDictionary(locale);
  } catch {
    dictionary = {};
  }
  return { t: (key: MessageKey, vars) => interpolate(dictionary[key] ?? MESSAGES[key], vars), locale };
}

/** Absolute URL of a portal page of the program (/a/<slug>/<page>). */
export async function portalUrl(slug: string, page = ""): Promise<string> {
  const settings = await getSettings();
  return absoluteUrl(settings, `/a/${slug}${page ? `/${page.replace(/^\/+/, "")}` : ""}`);
}

/** The owner of a program (merchant): email, name and whether emails carry the platform branding. */
export async function getProgramOwner(userId: number): Promise<{ email: string; name: string; removeBranding: boolean } | null> {
  const db = await getDb();
  const user = await db.selectFrom("users").select(["email", "name", "status"]).where("id", "=", userId).executeTakeFirst();
  if (!user || user.status !== "active") return null;
  const entitlements = await getEntitlementsForUserId(userId);
  return { email: user.email, name: user.name, removeBranding: entitlements.removeBranding };
}

/** "— Powered by Referzen" line (unless the owner's plan removes the branding). */
async function brandingLine(removeBranding: boolean): Promise<string> {
  if (removeBranding) return "";
  const settings = await getSettings();
  const text = settings.branding_text.trim();
  if (!text) return "";
  return `${text} · ${settings.branding_url || absoluteUrl(settings, "/")}`;
}

async function canEmail(): Promise<boolean> {
  try {
    return mailConfigured(await getSettings());
  } catch {
    return false;
  }
}

function logFailure(what: string, error: unknown) {
  console.error(`[referzen] ${what} failed:`, error instanceof Error ? error.message : error);
}

/** Send one affiliate email with the program's sign-off, branding and reply-to (the merchant). */
async function sendAffiliateMail(program: ProgramLike, affiliate: AffiliateLike, subject: string, lines: string[]): Promise<boolean> {
  if (!(await canEmail())) return false;
  if (!affiliate.email || affiliate.email.endsWith("@invalid")) return false;
  try {
    const { t } = await emailTranslator();
    const owner = await getProgramOwner(program.userId);
    const brand = await brandingLine(owner?.removeBranding ?? false);
    const text = [t("pmail.hi", { name: affiliate.name || affiliate.email }), "", ...lines, "", t("pmail.signoff", { program: program.name }), ...(brand ? ["", brand] : [])].join("\n");
    await sendMail({ to: affiliate.email, subject, text, replyTo: owner?.email });
    return true;
  } catch (error) {
    logFailure(`email to affiliate ${affiliate.id}`, error);
    return false;
  }
}

function commissionLine(program: ProgramLike, t: Translator, locale: string): string {
  const s = program.settings;
  const rate = s.commissionType === "percent" ? `${s.rate / 100}%` : formatMoney(s.rate, program.currency, locale);
  return t("pmail.commission", { rate });
}

// ── Affiliate account emails ──

/** After sign-up: "your account is ready" (approved) or "we received your application" (pending). */
export async function sendAffiliateWelcome(program: ProgramLike, affiliate: AffiliateLike): Promise<boolean> {
  const { t, locale } = await emailTranslator();
  const dashboard = await portalUrl(program.slug, "dashboard");
  if (affiliate.status === "approved") {
    const link = referralLink(program.domain, affiliate.code, { param: program.settings.refParams[0] });
    return sendAffiliateMail(program, affiliate, t("pmail.welcomeSubject", { program: program.name }), [
      t("pmail.welcomeApproved", { program: program.name }),
      "",
      link,
      "",
      commissionLine(program, t, locale),
      t("pmail.portalLink", { url: dashboard }),
    ]);
  }
  return sendAffiliateMail(program, affiliate, t("pmail.pendingSubject", { program: program.name }), [
    t("pmail.welcomePending", { program: program.name }),
    "",
    t("pmail.portalLink", { url: await portalUrl(program.slug, "login") }),
  ]);
}

/** The merchant approved a pending affiliate. */
export async function sendAffiliateApproved(program: ProgramLike, affiliate: AffiliateLike): Promise<boolean> {
  const { t, locale } = await emailTranslator();
  const link = referralLink(program.domain, affiliate.code, { param: program.settings.refParams[0] });
  return sendAffiliateMail(program, affiliate, t("pmail.approvedSubject", { program: program.name }), [
    t("pmail.approvedText", { program: program.name }),
    "",
    link,
    "",
    commissionLine(program, t, locale),
    t("pmail.portalLink", { url: await portalUrl(program.slug, "dashboard") }),
  ]);
}

/**
 * Invitation from the merchant: `token` is the plain token whose sha256 is stored in
 * affiliate_password_resets (valid 7 days); the link opens /a/<slug>/reset?token=….
 */
export async function sendAffiliateInvite(program: ProgramLike, affiliate: AffiliateLike, token: string, merchantName?: string): Promise<boolean> {
  const { t } = await emailTranslator();
  const owner = await getProgramOwner(program.userId);
  return sendAffiliateMail(program, affiliate, t("pmail.inviteSubject", { program: program.name }), [
    t("pmail.inviteText", { program: program.name, merchant: merchantName || owner?.name || program.name }),
    "",
    await portalUrl(program.slug, `reset?token=${encodeURIComponent(token)}`),
  ]);
}

/** Password reset link (valid 1 hour). `token` is the plain token; its sha256 is stored. */
export async function sendAffiliatePasswordReset(program: ProgramLike, affiliate: AffiliateLike, token: string): Promise<boolean> {
  const { t } = await emailTranslator();
  return sendAffiliateMail(program, affiliate, t("pmail.resetSubject", { program: program.name }), [
    t(affiliate.hasPassword === false ? "pmail.setText" : "pmail.resetText", { program: program.name }),
    "",
    await portalUrl(program.slug, `reset?token=${encodeURIComponent(token)}`),
    "",
    t("pmail.ignore"),
  ]);
}

// ── Merchant notifications ──

/**
 * Notify the merchant about a program event: the program's alert channels, or (when it has
 * none) an email to the owner. Only for events selected in the program's `notifyEvents`.
 */
export async function alertMerchant(
  program: ProgramLike,
  event: NotifyEvent,
  message: string,
  data: Record<string, number | string> = {},
): Promise<void> {
  try {
    if (!program.settings.notifyEvents.includes(event)) return;
    const payload = await buildAlertPayload(program, event, message, data);
    if (program.settings.alertChannelIds.length) {
      await notifyChannels(program.settings.alertChannelIds, payload, program.id, program.userId);
      return;
    }
    await emailOwner(program.userId, payload.event, payload);
  } catch (error) {
    logFailure(`merchant notification (${event}) for program ${program.id}`, error);
  }
}

async function emailOwner(userId: number, event: AlertEvent, payload: Awaited<ReturnType<typeof buildAlertPayload>>): Promise<void> {
  if (!(await canEmail())) return;
  const owner = await getProgramOwner(userId);
  if (!owner) return;
  const settings = await getSettings();
  const text = describeAlert(payload, settings.site_name);
  try {
    await sendMail({ to: owner.email, subject: text.subject, text: alertPlainText(payload, settings.site_name) });
    const { logAlert } = await import("@/lib/channels");
    await logAlert({ programId: payload.program?.id ?? null, channelId: null, event, ok: true }).catch(() => undefined);
  } catch (error) {
    logFailure(`owner email (${event})`, error);
  }
}

const money = (cents: number, currency: string) => formatMoney(cents, currency, "en-US");

/** A new affiliate joined (portal sign-up or merchant invite). */
export async function notifyNewAffiliate(program: ProgramLike, affiliate: AffiliateLike): Promise<void> {
  const pending = affiliate.status === "pending";
  await alertMerchant(
    program,
    "new_affiliate",
    pending
      ? `${affiliate.name} (${affiliate.email}) applied to ${program.name} and is waiting for your approval.`
      : `${affiliate.name} (${affiliate.email}) joined ${program.name}.`,
    { affiliate: affiliate.name, email: affiliate.email, code: affiliate.code, status: affiliate.status },
  );
}

/** A conversion was recorded: merchant alert + the affiliate's commission email. */
export async function notifyNewConversion(program: ProgramLike, affiliate: AffiliateLike, conversion: Pick<ConversionRecord, "amountCents" | "commissionCents" | "currency" | "externalId" | "source">): Promise<void> {
  await alertMerchant(
    program,
    "new_conversion",
    `New conversion: ${money(conversion.amountCents, conversion.currency)} via ${affiliate.name} (commission ${money(conversion.commissionCents, program.currency)}).`,
    {
      affiliate: affiliate.name,
      code: affiliate.code,
      amount: money(conversion.amountCents, conversion.currency),
      commission: money(conversion.commissionCents, program.currency),
      order: conversion.externalId,
      source: conversion.source,
    },
  );
  if (!program.settings.emailAffiliates || conversion.commissionCents <= 0) return;
  const { t, locale } = await emailTranslator();
  const commission = formatMoney(conversion.commissionCents, program.currency, locale);
  await sendAffiliateMail(program, affiliate, t("pmail.conversionSubject", { commission, program: program.name }), [
    t("pmail.conversionText", { program: program.name, amount: formatMoney(conversion.amountCents, conversion.currency, locale), commission }),
    ...(program.settings.holdDays > 0 ? [t("pmail.conversionHold", { days: program.settings.holdDays })] : []),
    "",
    t("pmail.portalLink", { url: await portalUrl(program.slug, "earnings") }),
  ]);
}

/** A conversion was reversed (refund, dispute, merchant). */
export async function notifyConversionReversed(
  program: ProgramLike,
  affiliate: AffiliateLike,
  conversion: Pick<ConversionRecord, "amountCents" | "commissionCents" | "currency" | "externalId">,
  reason?: string | null,
): Promise<void> {
  await alertMerchant(
    program,
    "conversion_reversed",
    `Conversion reversed: ${money(conversion.amountCents, conversion.currency)} via ${affiliate.name} (commission ${money(conversion.commissionCents, program.currency)} no longer due).`,
    {
      affiliate: affiliate.name,
      amount: money(conversion.amountCents, conversion.currency),
      commission: money(conversion.commissionCents, program.currency),
      order: conversion.externalId,
      ...(reason ? { reason } : {}),
    },
  );
  if (!program.settings.emailAffiliates || conversion.commissionCents <= 0) return;
  const { t, locale } = await emailTranslator();
  await sendAffiliateMail(program, affiliate, t("pmail.reversedSubject", { program: program.name }), [
    t("pmail.reversedText", { amount: formatMoney(conversion.amountCents, conversion.currency, locale), commission: formatMoney(conversion.commissionCents, program.currency, locale) }),
    "",
    t("pmail.portalLink", { url: await portalUrl(program.slug, "earnings") }),
  ]);
}

/** A payout was marked paid: the affiliate's email + merchant alert. */
export async function notifyPayoutPaid(program: ProgramLike, affiliate: AffiliateLike, payout: Pick<PayoutRecord, "amountCents" | "currency" | "method" | "reference" | "conversionCount">): Promise<void> {
  await alertMerchant(program, "payout_paid", `Payout of ${money(payout.amountCents, payout.currency)} to ${affiliate.name} marked as paid.`, {
    affiliate: affiliate.name,
    total: money(payout.amountCents, payout.currency),
    ...(payout.reference ? { reference: payout.reference } : {}),
  });
  if (!program.settings.emailAffiliates) return;
  const { t, locale } = await emailTranslator();
  const amount = formatMoney(payout.amountCents, payout.currency, locale);
  const method = t(`portal.method.${payout.method}` as MessageKey);
  await sendAffiliateMail(program, affiliate, t("pmail.payoutSubject", { amount, program: program.name }), [
    plural(t, "pmail.payoutText", payout.conversionCount, { amount, count: payout.conversionCount, method }),
    ...(payout.reference ? [t("pmail.payoutReference", { reference: payout.reference })] : []),
    "",
    t("pmail.portalLink", { url: await portalUrl(program.slug, "earnings") }),
  ]);
}

export { sendAffiliateMail };
