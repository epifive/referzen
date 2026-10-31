"use server";

import { getOwnedAffiliate } from "@/lib/affiliates";
import { approveConversion, getOwnedConversion, recordConversion, reopenConversion, reverseConversion } from "@/lib/conversions";
import { guardDashboard } from "@/lib/dashboard";
import { notifyConversionReversed, notifyNewConversion } from "@/lib/notify";
import { getT } from "@/lib/i18n/server";
import { plural, type Translator } from "@/lib/i18n/messages";
import { getOwnedProgram, type ProgramRecord } from "@/lib/programs";
import { randomToken } from "@/lib/tokens";
import { normalizeCurrency, str as clean, text } from "@/referral/normalize";
import type { FormState } from "../types";
import { decimalOf, idOf, ids, moneyOf, str } from "./helpers";

type Owned = { ok: true; program: ProgramRecord; t: Translator } | { ok: false; error: string };

async function owned(formData: FormData): Promise<Owned> {
  const guard = await guardDashboard();
  if (!guard.ok) return guard;
  const t = await getT();
  const program = await getOwnedProgram(idOf(formData.get("program_id")), guard.user.id);
  if (!program) return { ok: false, error: t("dash.merr.programNotFound") };
  return { ok: true, program, t };
}

/**
 * Approve a pending conversion (the merchant's review): it becomes payable right away. An
 * optional "commission" (program currency) replaces the commission; it is required for a
 * payment in another currency (flag currency_mismatch).
 */
export async function approveConversionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const conversion = await getOwnedConversion(o.program.id, idOf(formData.get("conversion_id")));
  if (!conversion) return { error: o.t("dash.merr.conversionNotFound") };
  let commissionCents: number | undefined;
  const raw = str(formData.get("commission")).trim();
  if (raw) {
    const n = decimalOf(raw);
    if (!Number.isFinite(n) || n < 0) return { error: o.t("dash.merr.commission") };
    commissionCents = n > 0 ? moneyOf(raw, o.program.currency) : 0;
  } else if (conversion.flags.includes("currency_mismatch") && conversion.commissionCents === 0) {
    return { error: o.t("dash.merr.commissionCurrency", { currency: o.program.currency }) };
  }
  if (!(await approveConversion(conversion.id, commissionCents))) return { error: o.t("dash.merr.conversionState") };
  return { success: o.t("dash.conv.approvedDone") };
}

/** Approve several pending conversions at once (other-currency ones without a commission are skipped). */
export async function bulkApproveConversionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  let n = 0;
  let skipped = 0;
  for (const id of ids(formData.getAll("conversion_ids")).slice(0, 500)) {
    const conversion = await getOwnedConversion(o.program.id, id);
    if (!conversion) continue;
    if (conversion.flags.includes("currency_mismatch") && conversion.commissionCents === 0) {
      skipped += 1;
      continue;
    }
    if (await approveConversion(conversion.id)) n += 1;
  }
  if (!n) return { error: skipped ? plural(o.t, "dash.conv.bulkCurrencySkipped", skipped) : o.t("dash.conv.bulkNone") };
  return { success: skipped ? `${plural(o.t, "dash.conv.bulkApproved", n)} ${plural(o.t, "dash.conv.bulkCurrencySkipped", skipped)}` : plural(o.t, "dash.conv.bulkApproved", n) };
}

export async function reverseConversionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const conversion = await getOwnedConversion(o.program.id, idOf(formData.get("conversion_id")));
  if (!conversion) return { error: o.t("dash.merr.conversionNotFound") };
  const reason = clean(str(formData.get("reason")), "", 255) || "Reversed by the merchant";
  const reversed = await reverseConversion(conversion.id, reason);
  if (!reversed) return { error: o.t("dash.merr.conversionState") };
  const affiliate = await getOwnedAffiliate(o.program.id, conversion.affiliateId);
  if (affiliate && formData.get("notify") !== "0") await notifyConversionReversed(o.program, affiliate, conversion, reason);
  return { success: reversed === "reversed_paid" ? o.t("dash.conv.reversedPaidDone") : o.t("dash.conv.reversedDone") };
}

export async function reopenConversionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const conversion = await getOwnedConversion(o.program.id, idOf(formData.get("conversion_id")));
  if (!conversion) return { error: o.t("dash.merr.conversionNotFound") };
  if (!(await reopenConversion(conversion.id))) return { error: o.t("dash.merr.conversionState") };
  return { success: o.t("dash.conv.reopenedDone") };
}

/**
 * Record a sale by hand (phone orders, invoices, corrections). Counts towards the monthly quota.
 * A sale in another currency without a commission entered is flagged currency_mismatch and stays
 * pending until the merchant approves it with a commission.
 */
export async function addManualConversionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const { program, t } = o;
  const affiliate = await getOwnedAffiliate(program.id, idOf(formData.get("affiliate_id")));
  if (!affiliate) return { error: t("dash.merr.pickAffiliate") };
  const currency = normalizeCurrency(str(formData.get("currency")), program.currency);
  const amountCents = moneyOf(formData.get("amount"), currency);
  if (amountCents <= 0) return { error: t("dash.merr.amount") };

  let occurredAt: string | undefined;
  const date = str(formData.get("date")).trim();
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { error: t("dash.merr.date") };
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) return { error: t("dash.merr.dateFuture") };
    // Today: the current time; earlier days: noon UTC.
    occurredAt = date === today ? new Date().toISOString() : `${date}T12:00:00.000Z`;
  }

  let commissionCents: number | undefined;
  if (str(formData.get("commission")).trim()) {
    const n = decimalOf(formData.get("commission"));
    if (!Number.isFinite(n) || n < 0) return { error: t("dash.merr.commission") };
    // Commissions are always in the program currency.
    commissionCents = n > 0 ? moneyOf(formData.get("commission"), program.currency) : 0;
  }

  const externalId = clean(str(formData.get("external_id")), "", 190) || `manual-${randomToken(10)}`;
  const result = await recordConversion({
    program,
    affiliate,
    source: "manual",
    externalId,
    amountCents,
    currency,
    occurredAt,
    commissionCents,
    status: formData.get("approve") === "on" ? "approved" : undefined,
    note: text(str(formData.get("note")), 500) || null,
  });
  if (result.status === "duplicate") return { error: t("dash.merr.duplicateOrder", { id: externalId }) };
  if (result.status === "rejected") return { error: result.reason === "quota" ? t("dash.merr.quota") : t("dash.merr.generic") };
  if (formData.get("notify") === "on") await notifyNewConversion(program, affiliate, result.conversion);
  return { success: t("dash.conv.added") };
}
