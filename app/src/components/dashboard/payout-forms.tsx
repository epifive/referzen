"use client";

import { useActionState, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, HandCoins, X } from "lucide-react";
import { initialFormState } from "@/app/actions/types";
import { cancelPayoutAction, createBatchAction, markBatchPaidAction, markPayoutPaidAction } from "@/app/actions/dashboard/payouts";
import { Checkbox, Field, Hint, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { type MessageKey, plural } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/referral/normalize";
import type { PayoutMethod } from "@/referral/types";
import { ActionButton } from "./actions";
import { HiddenFields, PopoverForm, useRefreshingAction } from "./merchant-client";

export interface DueRow {
  affiliateId: number;
  name: string;
  email: string;
  method: PayoutMethod;
  /** Masked payout details. */
  details: string;
  /** Net amount (commissions + adjustments). */
  amountCents: number;
  /** Adjustments deducted (0 or negative): commissions reversed after an earlier payout. */
  adjustmentCents: number;
  conversionCount: number;
  meetsMinimum: boolean;
  hasPayoutDetails: boolean;
}

/** Due balances with checkboxes and a live total → creates a draft payout batch. */
export function CreateBatchForm({ programId, currency, locale, rows, minPayoutCents }: { programId: number; currency: string; locale: string; rows: DueRow[]; minPayoutCents: number }) {
  const t = useT();
  const [state, action] = useActionState(createBatchAction, initialFormState);
  const payable = rows.filter((r) => r.meetsMinimum);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(payable.map((r) => r.affiliateId)));
  const total = useMemo(() => rows.filter((r) => selected.has(r.affiliateId)).reduce((s, r) => s + r.amountCents, 0), [rows, selected]);
  const missing = rows.filter((r) => selected.has(r.affiliateId) && !r.hasPayoutDetails).length;
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = payable.length > 0 && payable.every((r) => selected.has(r.affiliateId));
  const money = (c: number) => formatMoney(c, currency, locale);

  return (
    <form action={action}>
      <HiddenFields fields={{ program_id: programId }} />
      {state.error ? (
        <div className="border-b border-line p-4">
          <FormMessage state={state} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-start text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-10 border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5">
                <input
                  type="checkbox"
                  aria-label={t("dash.aff.selectAll")}
                  checked={all}
                  disabled={!payable.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(payable.map((r) => r.affiliateId)) : new Set())}
                  className="size-4 rounded border-line accent-[var(--primary)]"
                />
              </th>
              <th scope="col" className="border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5 text-start text-xs font-medium text-muted">
                {t("dash.aff.col.affiliate")}
              </th>
              <th scope="col" className="border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5 text-start text-xs font-medium text-muted">
                {t("dash.pay.col.method")}
              </th>
              <th scope="col" className="border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5 text-end text-xs font-medium text-muted">
                {t("dash.pay.col.conversions")}
              </th>
              <th scope="col" className="border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5 text-end text-xs font-medium text-muted">
                {t("dash.pay.col.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.affiliateId} className={cn(!r.meetsMinimum && "opacity-60", selected.has(r.affiliateId) && "bg-primary-soft/30")}>
                <td className="border-b border-line px-4 py-3 first:ps-5 last:pe-5">
                  <input
                    type="checkbox"
                    name="affiliate_ids"
                    value={r.affiliateId}
                    checked={selected.has(r.affiliateId)}
                    disabled={!r.meetsMinimum}
                    onChange={(e) => toggle(r.affiliateId, e.target.checked)}
                    aria-label={t("dash.aff.selectOne", { name: r.name })}
                    className="size-4 rounded border-line accent-[var(--primary)]"
                  />
                </td>
                <td className="border-b border-line px-4 py-3 first:ps-5 last:pe-5">
                  <p dir="auto" className="font-medium">
                    {r.name}
                  </p>
                  <p dir="ltr" className="text-start text-xs text-muted">
                    {r.email}
                  </p>
                </td>
                <td className="border-b border-line px-4 py-3 first:ps-5 last:pe-5">
                  <p className="font-medium">{t(`dash.pay.method.${r.method}` as MessageKey)}</p>
                  {r.hasPayoutDetails ? (
                    <p dir="ltr" className="flex items-center gap-1 text-start text-xs text-muted">
                      <CircleCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                      <span className="truncate">{r.details}</span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                      {t("dash.pay.missingDetails")}
                    </p>
                  )}
                </td>
                <td className="border-b border-line px-4 py-3 first:ps-5 last:pe-5 text-end tabular-nums">{r.conversionCount.toLocaleString(locale)}</td>
                <td className="border-b border-line px-4 py-3 first:ps-5 last:pe-5 text-end">
                  <bdi className="font-semibold tabular-nums">{money(r.amountCents)}</bdi>
                  {r.adjustmentCents ? <p className="text-[11px] text-muted">{t("dash.pay.adjustmentIncl", { amount: money(r.adjustmentCents) })}</p> : null}
                  {r.amountCents <= 0 ? (
                    <p className="text-[11px] text-muted">{t("dash.pay.carriedOver")}</p>
                  ) : !r.meetsMinimum ? (
                    <p className="text-[11px] text-muted">{t("dash.pay.belowMinimum", { min: money(minPayoutCents) })}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <Field label={t("dash.pay.note")} htmlFor="batch-note">
            <Input id="batch-note" name="note" maxLength={500} dir="auto" placeholder={t("dash.pay.notePlaceholder")} />
          </Field>
          {missing > 0 ? <Hint className="text-amber-700 dark:text-amber-400">{plural(t, "dash.pay.missingWarning", missing)}</Hint> : null}
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <p className="text-sm text-muted">
            {t("dash.pay.selectedTotal", { n: selected.size })} <bdi className="text-lg font-bold text-ink tabular-nums">{money(total)}</bdi>
          </p>
          <SubmitButton pendingText={t("dash.pay.creating")}>
            <HandCoins aria-hidden />
            {t("dash.pay.createBatch")}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function MarkBatchPaidForm({ programId, batchId, notifyDefault, canMail }: { programId: number; batchId: number; notifyDefault: boolean; canMail: boolean }) {
  const t = useT();
  const [state, action] = useRefreshingAction(markBatchPaidAction);
  return (
    <form action={action} className="space-y-4">
      <HiddenFields fields={{ program_id: programId, batch_id: batchId }} />
      <FormMessage state={state} />
      <Field label={t("dash.pay.reference")} htmlFor="bp-ref" hint={t("dash.pay.referenceHint")}>
        <Input id="bp-ref" name="reference" maxLength={190} dir="ltr" placeholder="PAYOUT-2026-10" />
      </Field>
      <div>
        <Checkbox name="notify" defaultChecked={notifyDefault} label={t("dash.pay.notify")} />
        <Hint>{canMail ? t("dash.pay.notifyHint") : t("dash.pay.notifyNoMail")}</Hint>
      </div>
      <SubmitButton pendingText={t("dash.pay.marking")} className="w-full">
        <CircleCheck aria-hidden />
        {t("dash.pay.markBatchPaid")}
      </SubmitButton>
    </form>
  );
}

export function PayoutRowActions({ programId, payoutId, name }: { programId: number; payoutId: number; name: string }) {
  const t = useT();
  const fields = { program_id: programId, payout_id: payoutId };
  return (
    <div className="flex justify-end gap-1">
      <PopoverForm action={markPayoutPaidAction} fields={fields} trigger={t("dash.pay.markPaid")} title={t("dash.pay.markPaidTitle", { name })} submitLabel={t("dash.pay.markPaidSubmit")}>
        <Input name="reference" maxLength={190} dir="ltr" placeholder={t("dash.pay.reference")} aria-label={t("dash.pay.reference")} />
        <Checkbox name="notify" value="1" defaultChecked label={<span className="text-xs">{t("dash.pay.notifyOne")}</span>} />
        <input type="hidden" name="notify" value="0" />
      </PopoverForm>
      <ActionButton action={cancelPayoutAction} fields={fields} variant="ghost" confirmText={t("dash.pay.cancelConfirm", { name })} label={t("dash.pay.cancel")}>
        <X aria-hidden />
      </ActionButton>
    </div>
  );
}
