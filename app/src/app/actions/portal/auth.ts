"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AffiliateExistsError, countUserAffiliates, createAffiliate, getAffiliate, getAffiliateByEmail, setAffiliatePassword, updateAffiliate, verifyAffiliateLogin } from "@/lib/affiliates";
import { isDemoMode } from "@/lib/config";
import { getDb, now } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { mailConfigured } from "@/lib/mail";
import { notifyNewAffiliate, sendAffiliatePasswordReset, sendAffiliateWelcome } from "@/lib/notify";
import { atLimit, getEntitlementsForUserId } from "@/lib/plans";
import { createAffiliateSession, destroyAffiliateSession } from "@/lib/portal-session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requestVisitorHash } from "@/lib/salts";
import { getProgramAvailability } from "@/lib/programs";
import { getSettings } from "@/lib/settings";
import { sha256 } from "@/lib/tokens";
import { httpUrl, normalizeEmail, str } from "@/referral/normalize";
import type { FormState } from "@/app/actions/types";
import { field, programFromForm } from "./helpers";

const MIN_PASSWORD = 8;
const RESET_MINUTES = 60;

/** Remember today's visitor hash of the affiliate's browser (same-visitor fraud check on conversions). */
async function recordVisitor(programId: number, affiliate: { id: number; payoutMethod: "paypal" | "bank" | "other" }): Promise<void> {
  try {
    await updateAffiliate(affiliate, { lastVisitorHash: await requestVisitorHash(programId, await headers()) });
  } catch (error) {
    console.error("[referzen] could not record the affiliate's visitor hash:", error);
  }
}

/** Website field: a bare domain is accepted and stored as https://… */
function cleanWebsite(v: string): string | null {
  const raw = str(v, "", 255);
  if (!raw) return "";
  const url = httpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return url && /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(url) ? url : null;
}

export async function affiliateSignup(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const program = await programFromForm(formData);
  if (!program) return { error: t("portal.err.notFound") };
  const availability = await getProgramAvailability(program);
  if (availability !== "active") return { error: availability === "paused" ? t("portal.paused") : t("portal.unavailable") };
  if (isDemoMode()) return { error: t("portal.err.demoSignup") };

  // Bots fill every field, including the hidden one.
  if (field(formData, "company")) return { success: t("portal.signup.received") };

  const ip = await clientIp();
  if (!rateLimit(`aff-signup:${ip}`, 5, 60 * 60_000)) return { error: t("portal.err.tooMany") };

  const name = str(field(formData, "name"), "", 120);
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");
  const website = cleanWebsite(field(formData, "website"));
  if (name.length < 2) return { error: t("portal.err.name") };
  if (!email) return { error: t("portal.err.email") };
  if (password.length < MIN_PASSWORD || password.length > 200) return { error: t("portal.err.passwordLength") };
  if (website === null) return { error: t("portal.err.website") };
  if (field(formData, "terms") !== "on") return { error: t("portal.err.terms") };

  // The owner's plan limits affiliates across all their programs.
  const entitlements = await getEntitlementsForUserId(program.userId);
  if (atLimit(await countUserAffiliates(program.userId), entitlements.maxAffiliates)) return { error: t("portal.err.full") };

  let affiliate;
  try {
    affiliate = await createAffiliate(program, { email, name, password, website: website || undefined, payoutDetails: { paypalEmail: email } });
  } catch (error) {
    if (error instanceof AffiliateExistsError) return { error: t("portal.err.exists") };
    throw error;
  }

  await notifyNewAffiliate(program, affiliate);
  await sendAffiliateWelcome(program, affiliate);
  await createAffiliateSession(affiliate.id, program.slug);
  await recordVisitor(program.id, affiliate);
  redirect(`/a/${program.slug}/dashboard?welcome=1`);
}

export async function affiliateLogin(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const program = await programFromForm(formData);
  if (!program) return { error: t("portal.err.notFound") };
  const ip = await clientIp();
  const email = normalizeEmail(field(formData, "email"));
  if (!rateLimit(`aff-login:${ip}`, 10, 15 * 60_000) || (email && !rateLimit(`aff-login:${program.id}:${email}`, 10, 15 * 60_000))) {
    return { error: t("portal.err.tooManyLogins") };
  }
  const password = field(formData, "password");
  if (!email || !password) return { error: t("portal.err.credentials") };
  const affiliate = await verifyAffiliateLogin(program.id, email, password.slice(0, 200));
  if (!affiliate) return { error: t("portal.err.credentials") };
  if (affiliate.status === "blocked") return { error: t("portal.err.blocked") };

  await createAffiliateSession(affiliate.id, program.slug);
  await recordVisitor(program.id, affiliate);
  redirect(`/a/${program.slug}/dashboard`);
}

/** Plain form action (no useActionState): signs out of this program's portal. */
export async function affiliateLogout(formData: FormData): Promise<void> {
  const program = await programFromForm(formData);
  if (!program) redirect("/");
  await destroyAffiliateSession(program.slug);
  redirect(`/a/${program.slug}/login?signedOut=1`);
}

export async function affiliateForgotPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const [t, settings] = await Promise.all([getT(), getSettings()]);
  const program = await programFromForm(formData);
  if (!program) return { error: t("portal.err.notFound") };
  if (!mailConfigured(settings)) return { error: t("portal.err.resetUnavailable") };
  if (isDemoMode()) return { error: t("portal.err.demo") };
  const ip = await clientIp();
  if (!rateLimit(`aff-reset:${ip}`, 5, 60 * 60_000)) return { error: t("portal.err.tooMany") };

  const email = normalizeEmail(field(formData, "email"));
  if (!email) return { error: t("portal.err.email") };
  // Same answer whether or not the address is registered (no account discovery).
  const message = t("portal.forgot.sent");
  const affiliate = await getAffiliateByEmail(program.id, email);
  if (!affiliate || affiliate.status === "blocked") return { success: message };
  if (!rateLimit(`aff-reset:${program.id}:${affiliate.id}`, 3, 60 * 60_000)) return { success: message };

  const token = crypto.randomBytes(32).toString("base64url");
  const db = await getDb();
  await db.deleteFrom("affiliate_password_resets").where("affiliate_id", "=", affiliate.id).where("expires_at", "<", now()).execute();
  await db
    .insertInto("affiliate_password_resets")
    .values({ token_hash: sha256(token), affiliate_id: affiliate.id, expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(), created_at: now() })
    .execute();
  if (!(await sendAffiliatePasswordReset(program, affiliate, token))) return { error: t("portal.err.mailFailed") };
  return { success: message };
}

/**
 * Reset (or first set, for invited affiliates) the password with a link token. The token's
 * sha256 is looked up in affiliate_password_resets; its expiry comes from the row (1 hour for
 * resets, 7 days for merchant invitations). Signs the affiliate in on success.
 */
export async function affiliateResetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const program = await programFromForm(formData);
  if (!program) return { error: t("portal.err.notFound") };
  if (isDemoMode()) return { error: t("portal.err.demo") };
  const ip = await clientIp();
  if (!rateLimit(`aff-reset-use:${ip}`, 20, 60 * 60_000)) return { error: t("portal.err.tooMany") };
  const token = field(formData, "token");
  const password = field(formData, "password");
  if (password.length < MIN_PASSWORD || password.length > 200) return { error: t("portal.err.passwordLength") };
  if (password !== field(formData, "confirm")) return { error: t("portal.err.passwordMatch") };
  if (token.length < 20 || token.length > 200) return { error: t("portal.err.linkInvalid") };

  const db = await getDb();
  const reset = await db.selectFrom("affiliate_password_resets").selectAll().where("token_hash", "=", sha256(token)).executeTakeFirst();
  if (!reset || reset.expires_at < now()) return { error: t("portal.err.linkInvalid") };
  const affiliate = await getAffiliate(reset.affiliate_id);
  if (!affiliate || affiliate.programId !== program.id) return { error: t("portal.err.linkInvalid") };
  if (affiliate.status === "blocked") return { error: t("portal.err.blocked") };

  // Also deletes every reset link and every portal session of the affiliate.
  await setAffiliatePassword(affiliate.id, password);
  await createAffiliateSession(affiliate.id, program.slug);
  await recordVisitor(program.id, affiliate);
  redirect(`/a/${program.slug}/dashboard?password=set`);
}
