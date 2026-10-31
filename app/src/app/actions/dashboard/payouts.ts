"use server";

import { redirect } from "next/navigation";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/messages";
import { notifyPayoutsPaid } from "@/lib/merchant-mail";
import { programPath } from "@/lib/merchant-program";
import { cancelPayout, createPayoutBatch, getOwnedBatch, getOwnedPayout, markBatchPaid, markPayoutPaid } from "@/lib/payouts";
import { getOwnedProgram, type ProgramRecord } from "@/lib/programs";
import { str as clean } from "@/referral/normalize";
import type { FormState } from "../types";
import { idOf, ids, str } from "./helpers";

type Owned = { ok: true; program: ProgramRecord; t: Translator } | { ok: false; error: string };

async function owned(formData: FormData): Promise<Owned> {
  const guard = await guardDashboard();
  if (!guard.ok) return guard;
  const t = await getT();
  const program = await getOwnedProgram(idOf(formData.get("program_id")), guard.user.id);
  if (!program) return { ok: false, error: t("dash.merr.programNotFound") };
  return { ok: true, program, t };
}

/** Create a draft batch for the selected affiliates' due balances, then open it. */
export async function createBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const affiliateIds = ids(formData.getAll("affiliate_ids"));
  if (!affiliateIds.length) return { error: o.t("dash.merr.pickPayouts") };
  const batchId = await createPayoutBatch(o.program, { affiliateIds, note: clean(str(formData.get("note")), "", 500) });
  if (!batchId) return { error: o.t("dash.merr.nothingDue") };
  redirect(`${programPath(o.program.id, `payouts/${batchId}`)}?created=1`);
}

export async function markBatchPaidAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const batch = await getOwnedBatch(o.program.id, idOf(formData.get("batch_id")));
  if (!batch) return { error: o.t("dash.merr.batchNotFound") };
  const paid = await markBatchPaid(batch.id, clean(str(formData.get("reference")), "", 190) || null);
  if (!paid.length) return { error: o.t("dash.merr.batchPaid") };
  if (formData.get("notify") === "on") await notifyPayoutsPaid(o.program, paid);
  redirect(`${programPath(o.program.id, `payouts/${batch.id}`)}?paid=${paid.length}`);
}

export async function markPayoutPaidAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const payout = await getOwnedPayout(o.program.id, idOf(formData.get("payout_id")));
  if (!payout) return { error: o.t("dash.merr.payoutNotFound") };
  const paid = await markPayoutPaid(payout.id, clean(str(formData.get("reference")), "", 190) || null);
  if (!paid) return { error: o.t("dash.merr.payoutState") };
  if (formData.get("notify") !== "0") await notifyPayoutsPaid(o.program, [paid]);
  return { success: o.t("dash.pay.payoutPaidDone") };
}

export async function cancelPayoutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const payout = await getOwnedPayout(o.program.id, idOf(formData.get("payout_id")));
  if (!payout) return { error: o.t("dash.merr.payoutNotFound") };
  if (!(await cancelPayout(payout.id))) return { error: o.t("dash.merr.payoutState") };
  // The batch is removed when its last payout is cancelled.
  if (payout.batchId && !(await getOwnedBatch(o.program.id, payout.batchId))) redirect(`${programPath(o.program.id, "payouts")}?cancelled=1`);
  return { success: o.t("dash.pay.cancelledDone") };
}
