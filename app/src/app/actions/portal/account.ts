"use server";

import { revalidatePath } from "next/cache";
import { setAffiliatePassword, updateAffiliate } from "@/lib/affiliates";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { createAffiliateSession } from "@/lib/portal-session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { httpUrl, isPayoutMethod, normalizePayoutDetails, str } from "@/referral/normalize";
import type { FormState } from "@/app/actions/types";
import { field, guardPortal } from "./helpers";

/** Payout method and details (only methods the program offers). */
export async function savePayoutSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const guard = await guardPortal(formData);
  if (!guard.ok) return { error: guard.error };
  const { program, affiliate } = guard;
  const ip = await clientIp();
  if (!rateLimit(`aff-save:${ip}`, 30, 10 * 60_000)) return { error: t("portal.err.tooMany") };

  const method = field(formData, "method");
  if (!isPayoutMethod(method) || !program.settings.payoutMethods.includes(method)) return { error: t("portal.err.method") };
  const details = normalizePayoutDetails(method, {
    paypalEmail: field(formData, "paypalEmail"),
    accountName: field(formData, "accountName"),
    accountNumber: field(formData, "accountNumber"),
    bankCode: field(formData, "bankCode"),
    bankName: field(formData, "bankName"),
    country: field(formData, "country"),
    note: field(formData, "note"),
  });
  if (method === "paypal" && !details.paypalEmail) return { error: t("portal.err.paypal") };
  if (method === "bank" && (!details.accountName || !details.accountNumber)) return { error: t("portal.err.bank") };
  if (method === "other" && !details.note) return { error: t("portal.err.other") };

  await updateAffiliate(affiliate, { payoutMethod: method, payoutDetails: details });
  revalidatePath(`/a/${program.slug}/settings`);
  return { success: t("portal.payout.saved") };
}

export async function saveAffiliateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const guard = await guardPortal(formData);
  if (!guard.ok) return { error: guard.error };
  const { program, affiliate } = guard;
  const ip = await clientIp();
  if (!rateLimit(`aff-save:${ip}`, 30, 10 * 60_000)) return { error: t("portal.err.tooMany") };

  const name = str(field(formData, "name"), "", 120);
  if (name.length < 2) return { error: t("portal.err.name") };
  const rawWebsite = str(field(formData, "website"), "", 255);
  let website: string | null = null;
  if (rawWebsite) {
    website = httpUrl(/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`);
    if (!website || !/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(website)) return { error: t("portal.err.website") };
  }
  await updateAffiliate(affiliate, { name, website });
  revalidatePath(`/a/${program.slug}`, "layout");
  return { success: t("portal.profile.saved") };
}

/** Change the password (current one required); other devices are signed out, this one stays signed in. */
export async function changeAffiliatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const guard = await guardPortal(formData);
  if (!guard.ok) return { error: guard.error };
  const { program, affiliate } = guard;
  const ip = await clientIp();
  if (!rateLimit(`aff-password:${ip}`, 10, 15 * 60_000)) return { error: t("portal.err.tooMany") };

  const current = field(formData, "current");
  const password = field(formData, "password");
  if (password.length < 8 || password.length > 200) return { error: t("portal.err.passwordLength") };
  if (password !== field(formData, "confirm")) return { error: t("portal.err.passwordMatch") };
  const db = await getDb();
  const row = await db.selectFrom("affiliates").select("password_hash").where("id", "=", affiliate.id).executeTakeFirst();
  if (row?.password_hash && !(await verifyPassword(current.slice(0, 200), row.password_hash))) return { error: t("portal.err.currentPassword") };

  await setAffiliatePassword(affiliate.id, password);
  await createAffiliateSession(affiliate.id, program.slug);
  return { success: t("portal.password.changed") };
}
