"use server";

import { redirect } from "next/navigation";
import {
  AffiliateExistsError,
  countUserAffiliates,
  createAffiliate,
  deleteAffiliate,
  getAffiliateByEmail,
  getOwnedAffiliate,
  isCodeTaken,
  listProgramAffiliates,
  setAffiliateStatus,
  updateAffiliate,
  type AffiliateRecord,
} from "@/lib/affiliates";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { plural, type Translator } from "@/lib/i18n/messages";
import { canSendMail, inviteAffiliate } from "@/lib/merchant-mail";
import { sendAffiliateApproved } from "@/lib/notify";
import { programPath } from "@/lib/merchant-program";
import { atLimit } from "@/lib/plans";
import { getOwnedProgram, type ProgramRecord } from "@/lib/programs";
import { rateLimit } from "@/lib/rate-limit";
import { isAffiliateStatus, normalizeCode, normalizeEmail, str as clean, text } from "@/referral/normalize";
import { COMMISSION_TYPES, type CommissionOverride, type CommissionType } from "@/referral/types";
import type { FormState } from "../types";
import { decimalOf, idOf, ids, moneyOf, str } from "./helpers";

type Owned =
  | { ok: true; userId: number; userName: string; maxAffiliates: number; program: ProgramRecord; affiliate?: AffiliateRecord; t: Translator }
  | { ok: false; error: string };

async function owned(formData: FormData, withAffiliate: boolean): Promise<Owned> {
  const guard = await guardDashboard();
  if (!guard.ok) return guard;
  const t = await getT();
  const program = await getOwnedProgram(idOf(formData.get("program_id")), guard.user.id);
  if (!program) return { ok: false, error: t("dash.merr.programNotFound") };
  if (!withAffiliate) return { ok: true, userId: guard.user.id, userName: guard.user.name, maxAffiliates: guard.entitlements.maxAffiliates, program, t };
  const affiliate = await getOwnedAffiliate(program.id, idOf(formData.get("affiliate_id")));
  if (!affiliate) return { ok: false, error: t("dash.merr.affiliateNotFound") };
  return { ok: true, userId: guard.user.id, userName: guard.user.name, maxAffiliates: guard.entitlements.maxAffiliates, program, affiliate, t };
}

export interface InviteState extends FormState {
  /** Set-password link, shown when it could not be emailed. */
  link?: string;
  emailed?: boolean;
}

export async function inviteAffiliateAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const o = await owned(formData, false);
  if (!o.ok) return { error: o.error };
  const { program, t } = o;
  if (atLimit(await countUserAffiliates(o.userId), o.maxAffiliates)) return { error: t("dash.merr.affiliateLimit", { n: o.maxAffiliates }) };
  if (!rateLimit(`rz-invite:${o.userId}`, 60, 60 * 60_000)) return { error: t("dash.channels.err.rate") };
  const email = normalizeEmail(str(formData.get("email")));
  if (!email) return { error: t("dash.merr.email") };
  const rawCode = str(formData.get("code")).trim();
  const code = rawCode ? normalizeCode(rawCode) : "";
  if (rawCode && !code) return { error: t("dash.merr.code") };
  if (code && (await isCodeTaken(program.id, code))) return { error: t("dash.merr.codeTaken") };
  let affiliate: AffiliateRecord;
  try {
    affiliate = await createAffiliate(program, { email, name: clean(str(formData.get("name")), "", 120), code: code || undefined, status: "approved" });
  } catch (error) {
    if (error instanceof AffiliateExistsError) return { error: t("dash.merr.affiliateExists") };
    throw error;
  }
  const wantsEmail = formData.get("send_email") === "on";
  const { link, emailed } = await inviteAffiliate(program, affiliate, { email: wantsEmail, merchantName: o.userName });
  if (emailed) return { success: t("dash.aff.invitedEmailed", { email }), emailed: true };
  return { success: wantsEmail ? t("dash.aff.invitedNoMail") : t("dash.aff.invitedLink"), link, emailed: false };
}

/** New set-password link for an affiliate who hasn't signed in yet (emailed when possible). */
export async function resendInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const o = await owned(formData, true);
  if (!o.ok) return { error: o.error };
  if (!rateLimit(`rz-invite:${o.userId}`, 60, 60 * 60_000)) return { error: o.t("dash.channels.err.rate") };
  const { link, emailed } = await inviteAffiliate(o.program, o.affiliate!, { email: await canSendMail(), merchantName: o.userName });
  if (emailed) return { success: o.t("dash.aff.invitedEmailed", { email: o.affiliate!.email }), emailed: true };
  return { success: o.t("dash.aff.invitedLink"), link, emailed: false };
}

export async function setAffiliateStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData, true);
  if (!o.ok) return { error: o.error };
  const status = str(formData.get("status"));
  if (!isAffiliateStatus(status)) return { error: o.t("dash.merr.generic") };
  await setAffiliateStatus(o.affiliate!.id, status);
  if (status === "approved" && o.affiliate!.status === "pending") await sendAffiliateApproved(o.program, { ...o.affiliate!, status });
  return { success: o.t(status === "approved" ? "dash.aff.approvedDone" : status === "blocked" ? "dash.aff.blockedDone" : "dash.aff.pendingDone") };
}

/** Approve or block several affiliates at once (checkboxes on the list). */
export async function bulkAffiliateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData, false);
  if (!o.ok) return { error: o.error };
  const status = str(formData.get("status"));
  if (status !== "approved" && status !== "blocked") return { error: o.t("dash.merr.generic") };
  const wanted = formData.get("all_pending") === "1" ? (await listProgramAffiliates(o.program.id, { status: "pending", limit: 500 })).map((a) => a.id) : ids(formData.getAll("affiliate_ids"));
  let n = 0;
  for (const id of wanted.slice(0, 500)) {
    const a = await getOwnedAffiliate(o.program.id, id);
    if (a && a.status !== status) {
      await setAffiliateStatus(a.id, status);
      if (status === "approved" && a.status === "pending") await sendAffiliateApproved(o.program, { ...a, status });
      n += 1;
    }
  }
  if (!n) return { error: o.t("dash.aff.bulkNone") };
  return { success: plural(o.t, status === "approved" ? "dash.aff.bulkApproved" : "dash.aff.bulkBlocked", n) };
}

export async function deleteAffiliateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData, true);
  if (!o.ok) return { error: o.error };
  await deleteAffiliate(o.affiliate!.id);
  if (formData.get("redirect") === "1") redirect(`${programPath(o.program.id, "affiliates")}?deleted=1`);
  return { success: o.t("dash.aff.deleted") };
}

/** Profile, referral code, coupon, commission override and notes of an affiliate. */
export async function saveAffiliateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData, true);
  if (!o.ok) return { error: o.error };
  const { program, t } = o;
  const affiliate = o.affiliate!;
  const name = clean(str(formData.get("name")), "", 120);
  if (!name) return { error: t("dash.merr.name") };
  const email = normalizeEmail(str(formData.get("email")));
  if (!email) return { error: t("dash.merr.email") };
  if (email !== affiliate.email) {
    const other = await getAffiliateByEmail(program.id, email);
    if (other && other.id !== affiliate.id) return { error: t("dash.merr.affiliateExists") };
  }
  const code = normalizeCode(str(formData.get("code")));
  if (!code) return { error: t("dash.merr.code") };
  if (code !== affiliate.code && (await isCodeTaken(program.id, code, affiliate.id))) return { error: t("dash.merr.codeTaken") };

  let override: CommissionOverride | null = null;
  const overrideType = str(formData.get("overrideType"));
  if (overrideType && str(formData.get("overrideRate")).trim()) {
    const type: CommissionType = (COMMISSION_TYPES as readonly string[]).includes(overrideType) ? (overrideType as CommissionType) : "percent";
    if (type === "percent") {
      const pct = decimalOf(formData.get("overrideRate"));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: t("dash.merr.ratePercent") };
      override = { commissionType: "percent", rate: Math.round(pct * 100) };
    } else {
      const cents = moneyOf(formData.get("overrideRate"), program.currency);
      if (cents <= 0 && decimalOf(formData.get("overrideRate")) !== 0) return { error: t("dash.merr.rateFixed") };
      override = { commissionType: "fixed", rate: cents };
    }
  }

  await updateAffiliate(affiliate, {
    name,
    email,
    code,
    couponCode: clean(str(formData.get("couponCode")), "", 60) || null,
    commissionOverride: override,
    website: clean(str(formData.get("website")), "", 255) || null,
    notes: text(str(formData.get("notes")), 5000) || null,
  });
  return { success: t("dash.aff.saved") };
}
