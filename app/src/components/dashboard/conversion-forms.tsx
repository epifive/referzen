"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/app/actions/types";
import { Check, Filter, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { addManualConversionAction, approveConversionAction, reopenConversionAction, reverseConversionAction } from "@/app/actions/dashboard/conversions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Hint, Input, Label, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { fromMinorUnits } from "@/referral/normalize";
import { CONVERSION_SOURCES, type ConversionFlag, type ConversionStatus } from "@/referral/types";
import { ActionButton } from "./actions";
import { HiddenFields, PopoverForm, useRefreshingAction } from "./merchant-client";
import { CURRENCIES } from "./program-forms";

/**
 * Approve / reverse / reopen buttons for one conversion. A payment in another currency than the
 * program's (flag currency_mismatch) is approved with a commission entered in `currency`.
 * Paid conversions can be reversed too: the commission is deducted from the next payout.
 */
export function ConversionActions({
  programId,
  currency,
  conversion,
}: {
  programId: number;
  /** Program currency (commissions). */
  currency: string;
  conversion: { id: number; status: ConversionStatus; payoutId: number | null; flags: ConversionFlag[]; commissionCents: number };
}) {
  const t = useT();
  const fields = { program_id: programId, conversion_id: conversion.id };
  const needsCommission = conversion.flags.includes("currency_mismatch");
  return (
    <div className="flex flex-nowrap items-start justify-end gap-1 whitespace-nowrap">
      {conversion.status === "pending" && needsCommission ? (
        <PopoverForm
          action={approveConversionAction}
          fields={fields}
          trigger={
            <>
              <Check aria-hidden />
              <span className="max-2xl:sr-only">{t("dash.conv.approve")}</span>
            </>
          }
          title={t("dash.conv.approveCurrencyTitle")}
          submitLabel={t("dash.conv.approve")}
        >
          <p className="text-xs whitespace-normal text-muted">{t("dash.conv.approveCurrencyText", { currency })}</p>
          <div>
            <Label htmlFor={`appr-${conversion.id}`} className="text-xs font-normal text-muted">
              {t("dash.conv.commissionIn", { currency })}
            </Label>
            <Input
              id={`appr-${conversion.id}`}
              name="commission"
              required={conversion.commissionCents === 0}
              inputMode="decimal"
              dir="ltr"
              placeholder="10.00"
              defaultValue={conversion.commissionCents > 0 ? String(fromMinorUnits(conversion.commissionCents, currency)) : undefined}
            />
          </div>
        </PopoverForm>
      ) : conversion.status === "pending" ? (
        <ActionButton action={approveConversionAction} fields={fields} label={t("dash.conv.approve")}>
          <Check aria-hidden />
          <span className="max-2xl:sr-only">{t("dash.conv.approve")}</span>
        </ActionButton>
      ) : null}
      {conversion.status === "pending" || conversion.status === "approved" || conversion.status === "paid" ? (
        <PopoverForm
          action={reverseConversionAction}
          fields={fields}
          triggerVariant="ghost"
          trigger={
            <>
              <Undo2 aria-hidden />
              <span className="max-2xl:sr-only">{t("dash.conv.reverse")}</span>
            </>
          }
          title={t("dash.conv.reverseTitle")}
          submitLabel={t("dash.conv.reverseSubmit")}
          submitVariant="danger"
        >
          {conversion.status === "paid" ? <p className="text-xs whitespace-normal text-muted">{t("dash.conv.reversePaidHint")}</p> : null}
          <div>
            <Label htmlFor={`rev-${conversion.id}`} className="text-xs font-normal text-muted">
              {t("dash.conv.reason")}
            </Label>
            <Input id={`rev-${conversion.id}`} name="reason" maxLength={255} dir="auto" placeholder={t("dash.conv.reasonPlaceholder")} list="rz-reasons" />
          </div>
          <Checkbox name="notify" value="1" defaultChecked label={<span className="text-xs">{t("dash.conv.notifyAffiliate")}</span>} />
          {/* Unchecked: send notify=0 so the action skips the email. */}
          <input type="hidden" name="notify" value="0" />
        </PopoverForm>
      ) : null}
      {(conversion.status === "reversed" || conversion.status === "approved") && !conversion.payoutId ? (
        <ActionButton action={reopenConversionAction} fields={fields} variant="ghost" label={t("dash.conv.reopen")} confirmText={t("dash.conv.reopenConfirm")}>
          <RotateCcw aria-hidden />
          {conversion.status === "reversed" ? <span className="max-2xl:sr-only">{t("dash.conv.reopen")}</span> : null}
        </ActionButton>
      ) : null}
    </div>
  );
}

/** Suggestions for the reversal reason input. */
export function ReasonList() {
  const t = useT();
  return (
    <datalist id="rz-reasons">
      {(["dash.conv.reasonRefund", "dash.conv.reasonChargeback", "dash.conv.reasonFraud", "dash.conv.reasonTest"] as const).map((k) => (
        <option key={k} value={t(k)} />
      ))}
    </datalist>
  );
}

export function ManualConversionForm({
  programId,
  currency,
  affiliates,
  defaultAffiliateId,
}: {
  programId: number;
  currency: string;
  affiliates: Array<{ id: number; name: string; email: string; status: string }>;
  defaultAffiliateId?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useRefreshingAction(async (prev: FormState, fd: FormData) => {
    const result = await addManualConversionAction(prev, fd);
    if (!result.error) setFormKey((k) => k + 1);
    return result;
  });
  const today = new Date().toISOString().slice(0, 10);
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline">
        <Plus aria-hidden />
        {t("dash.conv.addManual")}
      </Button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-primary-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{t("dash.conv.manualTitle")}</p>
          <p className="mt-0.5 text-xs text-muted">{t("dash.conv.manualText")}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("nav.closeMenu")} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <form key={formKey} action={action} className="space-y-4">
        <HiddenFields fields={{ program_id: programId }} />
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("dash.conv.affiliate")} htmlFor="mc-aff" className="sm:col-span-2">
            <Select id="mc-aff" name="affiliate_id" required defaultValue={defaultAffiliateId ?? ""}>
              <option value="" disabled>
                {t("dash.conv.pickAffiliate")}
              </option>
              {affiliates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.email}){a.status !== "approved" ? ` · ${t(`dash.aff.status.${a.status}` as MessageKey)}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("dash.conv.amount")} htmlFor="mc-amount">
            <Input id="mc-amount" name="amount" required inputMode="decimal" dir="ltr" placeholder="49.00" />
          </Field>
          <Field label={t("dash.pset.currency")} htmlFor="mc-cur">
            <Select id="mc-cur" name="currency" defaultValue={currency} dir="ltr">
              {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("dash.conv.orderId")} htmlFor="mc-ext" hint={t("dash.conv.orderIdHint")}>
            <Input id="mc-ext" name="external_id" maxLength={190} dir="ltr" placeholder="INV-1001" />
          </Field>
          <Field label={t("dash.conv.date")} htmlFor="mc-date">
            <Input id="mc-date" name="date" type="date" max={today} defaultValue={today} dir="ltr" />
          </Field>
          <Field label={t("dash.conv.commissionOptional")} htmlFor="mc-comm" hint={t("dash.conv.commissionHintCurrency", { currency })} className="sm:col-span-2">
            <Input id="mc-comm" name="commission" inputMode="decimal" dir="ltr" placeholder={t("dash.conv.commissionAuto")} />
          </Field>
        </div>
        <Field label={t("dash.conv.note")} htmlFor="mc-note">
          <Textarea id="mc-note" name="note" rows={2} maxLength={500} dir="auto" className="min-h-16" />
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="approve" label={t("dash.conv.approveNow")} />
          <Checkbox name="notify" defaultChecked label={t("dash.conv.notifyNew")} />
        </div>
        <Hint>{t("dash.conv.quotaHint")}</Hint>
        <SubmitButton pendingText={t("dash.conv.adding")}>{t("dash.conv.addSubmit")}</SubmitButton>
      </form>
    </div>
  );
}

/** Filter bar: status, source, affiliate, date range, flagged, search (all in the URL). */
export function ConversionFilters({
  base,
  current,
  affiliates,
}: {
  base: string;
  current: { status?: string; source?: string; affiliate?: string; from?: string; to?: string; flagged?: string; q?: string };
  affiliates: Array<{ id: number; name: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const active = Object.entries(current).some(([k, v]) => k !== "status" && Boolean(v));
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const sp = new URLSearchParams();
        for (const [k, v] of fd.entries()) if (typeof v === "string" && v.trim()) sp.set(k, v.trim());
        router.push(sp.size ? `${base}?${sp}` : base, { scroll: false });
      }}
      role="search"
    >
      {current.status ? <input type="hidden" name="status" value={current.status} /> : null}
      <Select name="source" defaultValue={current.source ?? ""} aria-label={t("dash.conv.col.source")}>
        <option value="">{t("dash.conv.anySource")}</option>
        {CONVERSION_SOURCES.map((s) => (
          <option key={s} value={s}>
            {t(`dash.conv.source.${s}` as MessageKey)}
          </option>
        ))}
      </Select>
      <Select name="affiliate" defaultValue={current.affiliate ?? ""} aria-label={t("dash.conv.affiliate")}>
        <option value="">{t("dash.conv.anyAffiliate")}</option>
        {affiliates.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Input name="q" type="search" defaultValue={current.q ?? ""} placeholder={t("dash.conv.searchPlaceholder")} aria-label={t("dash.conv.searchPlaceholder")} />
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:row-span-2 lg:flex-col">
        <Button type="submit" className="flex-1">
          <Filter aria-hidden />
          {t("dash.conv.apply")}
        </Button>
        {active ? (
          <Button variant="ghost" className="flex-1" onClick={() => router.push(current.status ? `${base}?status=${current.status}` : base, { scroll: false })}>
            {t("dash.aff.clearFilters")}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="cf-from" className="shrink-0 text-xs text-muted">
          {t("dash.conv.from")}
        </label>
        <Input id="cf-from" name="from" type="date" defaultValue={current.from ?? ""} dir="ltr" />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="cf-to" className="shrink-0 text-xs text-muted">
          {t("dash.conv.to")}
        </label>
        <Input id="cf-to" name="to" type="date" defaultValue={current.to ?? ""} dir="ltr" />
      </div>
      <Checkbox name="flagged" value="1" defaultChecked={current.flagged === "1"} label={t("dash.conv.flaggedOnly")} className="sm:col-span-2 lg:col-span-1" />
    </form>
  );
}
