"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, RefreshCw, UserPlus, X } from "lucide-react";
import { inviteAffiliateAction, resendInviteAction, saveAffiliateAction, type InviteState } from "@/app/actions/dashboard/affiliates";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Hint, Input, Label, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { CommissionOverride, CommissionType } from "@/referral/types";
import { CopyField } from "./copy";
import { HiddenFields, useRefreshingAction } from "./merchant-client";
import { majorString } from "./program-forms";

/** "Invite affiliate" button + modal dialog (also opened by the #invite hash). */
export function InviteAffiliateDialog({ programId, canMail, disabled, portalUrl }: { programId: number; canMail: boolean; disabled: boolean; portalUrl: string }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useRefreshingAction<InviteState>(async (prev, fd) => {
    const result = await inviteAffiliateAction(prev, fd);
    if (!result.error) setFormKey((k) => k + 1);
    return result;
  });

  useEffect(() => {
    if (!disabled && window.location.hash === "#invite") ref.current?.showModal();
  }, [disabled]);

  return (
    <>
      <Button onClick={() => ref.current?.showModal()} disabled={disabled}>
        <UserPlus aria-hidden />
        {t("dash.aff.invite")}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="invite-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id="invite-title" className="font-sans text-base font-semibold tracking-normal">
            {t("dash.aff.inviteTitle")}
          </h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label={t("nav.closeMenu")} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted">{t("dash.aff.inviteText")}</p>
          {state.success ? (
            <Alert tone="success" title={state.success}>
              {state.link ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs">{t("dash.aff.inviteLinkHint")}</p>
                  <CopyField value={state.link} label={t("dash.aff.inviteLink")} />
                </div>
              ) : null}
            </Alert>
          ) : null}
          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          <form key={formKey} action={action} className="space-y-4">
            <HiddenFields fields={{ program_id: programId }} />
            <Field label={t("dash.aff.email")} htmlFor="inv-email">
              <Input id="inv-email" name="email" type="email" required dir="ltr" autoComplete="off" placeholder="partner@example.com" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("dash.aff.name")} htmlFor="inv-name">
                <Input id="inv-name" name="name" maxLength={120} dir="auto" placeholder={t("dash.aff.namePlaceholder")} />
              </Field>
              <Field label={t("dash.aff.codeOptional")} htmlFor="inv-code">
                <Input id="inv-code" name="code" maxLength={32} dir="ltr" placeholder="jane" className="font-mono" />
              </Field>
            </div>
            <div>
              <Checkbox name="send_email" defaultChecked={canMail} disabled={!canMail} label={t("dash.aff.sendEmail")} />
              <Hint>{canMail ? t("dash.aff.sendEmailHint") : t("dash.aff.noMailHint")}</Hint>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p dir="ltr" className="min-w-0 truncate text-xs text-muted">
                {portalUrl}
              </p>
              <SubmitButton pendingText={t("dash.aff.inviting")}>
                <Mail aria-hidden />
                {t("dash.aff.inviteSubmit")}
              </SubmitButton>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}

export function ResendInviteForm({ programId, affiliateId }: { programId: number; affiliateId: number }) {
  const t = useT();
  const [state, action] = useRefreshingAction<InviteState>(resendInviteAction);
  return (
    <div className="space-y-3">
      <form action={action}>
        <HiddenFields fields={{ program_id: programId, affiliate_id: affiliateId }} />
        <SubmitButton variant="outline" size="sm" pendingText={t("dash.aff.inviting")}>
          <RefreshCw aria-hidden />
          {t("dash.aff.resend")}
        </SubmitButton>
      </form>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? (
        <Alert tone="success" title={state.success}>
          {state.link ? <CopyField value={state.link} label={t("dash.aff.inviteLink")} className="mt-2" /> : null}
        </Alert>
      ) : null}
    </div>
  );
}

export function AffiliateEditForm({
  programId,
  affiliate,
  currency,
  programRateText,
}: {
  programId: number;
  affiliate: { id: number; name: string; email: string; code: string; couponCode: string | null; website: string | null; notes: string | null; commissionOverride: CommissionOverride | null };
  currency: string;
  programRateText: string;
}) {
  const t = useT();
  const [state, action] = useRefreshingAction(saveAffiliateAction);
  const o = affiliate.commissionOverride;
  const [type, setType] = useState<"" | CommissionType>(o ? (o.commissionType ?? "percent") : "");
  const overrideValue = o ? ((o.commissionType ?? "percent") === "percent" ? String((o.rate ?? 0) / 100) : majorString(o.rate ?? 0, currency)) : "";
  return (
    <form action={action} className="space-y-5">
      <HiddenFields fields={{ program_id: programId, affiliate_id: affiliate.id }} />
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("dash.aff.name")} htmlFor="ae-name">
          <Input id="ae-name" name="name" required maxLength={120} dir="auto" defaultValue={affiliate.name} />
        </Field>
        <Field label={t("dash.aff.email")} htmlFor="ae-email">
          <Input id="ae-email" name="email" type="email" required dir="ltr" defaultValue={affiliate.email} />
        </Field>
        <Field label={t("dash.aff.code")} htmlFor="ae-code" hint={t("dash.aff.codeHint")}>
          <Input id="ae-code" name="code" required maxLength={32} dir="ltr" defaultValue={affiliate.code} className="font-mono" />
        </Field>
        <Field label={t("dash.aff.coupon")} htmlFor="ae-coupon" hint={t("dash.aff.couponHint")}>
          <Input id="ae-coupon" name="couponCode" maxLength={60} dir="ltr" defaultValue={affiliate.couponCode ?? ""} className="font-mono" placeholder="JANE20" />
        </Field>
      </div>
      <Field label={t("dash.aff.website")} htmlFor="ae-web">
        <Input id="ae-web" name="website" maxLength={255} dir="ltr" defaultValue={affiliate.website ?? ""} placeholder="https://" />
      </Field>
      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium">{t("dash.aff.override")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ae-otype">{t("dash.aff.overrideType")}</Label>
            <Select id="ae-otype" name="overrideType" value={type} onChange={(e) => setType(e.target.value as "" | CommissionType)}>
              <option value="">{t("dash.aff.overrideNone", { rate: programRateText })}</option>
              <option value="percent">{t("dash.pset.typePercent")}</option>
              <option value="fixed">{t("dash.pset.typeFixed")}</option>
            </Select>
          </div>
          {type ? (
            <div>
              <Label htmlFor="ae-orate">{type === "percent" ? t("dash.pset.ratePercent") : t("dash.pset.rateFixed")}</Label>
              <div className="flex">
                <Input key={type} id="ae-orate" name="overrideRate" required inputMode="decimal" dir="ltr" defaultValue={type === (o?.commissionType ?? "percent") ? overrideValue : ""} className="rounded-e-none" />
                <span dir="ltr" className="inline-flex h-10 items-center rounded-e-lg border border-s-0 border-line bg-paper px-3 text-sm text-muted">
                  {type === "percent" ? "%" : currency}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <Hint>{t("dash.aff.overrideHint")}</Hint>
      </fieldset>
      <Field label={t("dash.aff.notes")} htmlFor="ae-notes" hint={t("dash.aff.notesHint")}>
        <Textarea id="ae-notes" name="notes" rows={3} maxLength={5000} dir="auto" defaultValue={affiliate.notes ?? ""} />
      </Field>
      <SubmitButton pendingText={t("dash.pset.saving")}>{t("dash.pset.save")}</SubmitButton>
    </form>
  );
}
