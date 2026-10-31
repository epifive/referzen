"use client";

import { useActionState, useState } from "react";
import { changeAffiliatePassword, saveAffiliateProfile, savePayoutSettings } from "@/app/actions/portal/account";
import { initialFormState } from "@/app/actions/types";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { PayoutDetails, PayoutMethod } from "@/referral/types";

export function PayoutSettingsForm({ slug, methods, method, details }: { slug: string; methods: PayoutMethod[]; method: PayoutMethod; details: PayoutDetails }) {
  const t = useT();
  const [state, action] = useActionState(savePayoutSettings, initialFormState);
  const [current, setCurrent] = useState<PayoutMethod>(methods.includes(method) ? method : methods[0]);
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      {methods.length > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("portal.payout.method")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {methods.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  current === m ? "border-primary bg-primary-soft font-medium" : "border-line hover:border-primary-line",
                )}
              >
                <input type="radio" name="method" value={m} checked={current === m} onChange={() => setCurrent(m)} className="accent-[var(--primary)]" />
                {t(`portal.method.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="method" value={current} />
      )}

      {current === "paypal" ? (
        <Field label={t("portal.payout.paypalEmail")} htmlFor="paypalEmail" hint={t("portal.payout.paypalHint")}>
          <Input id="paypalEmail" name="paypalEmail" type="email" required defaultValue={details.paypalEmail ?? ""} dir="ltr" maxLength={190} />
        </Field>
      ) : null}
      {current === "bank" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("portal.payout.accountName")} htmlFor="accountName">
            <Input id="accountName" name="accountName" required defaultValue={details.accountName ?? ""} maxLength={120} />
          </Field>
          <Field label={t("portal.payout.accountNumber")} htmlFor="accountNumber" hint={t("portal.payout.accountNumberHint")}>
            <Input id="accountNumber" name="accountNumber" required defaultValue={details.accountNumber ?? ""} dir="ltr" maxLength={60} />
          </Field>
          <Field label={t("portal.payout.bankCode")} htmlFor="bankCode" hint={t("portal.payout.bankCodeHint")}>
            <Input id="bankCode" name="bankCode" defaultValue={details.bankCode ?? ""} dir="ltr" maxLength={40} />
          </Field>
          <Field label={t("portal.payout.bankName")} htmlFor="bankName">
            <Input id="bankName" name="bankName" defaultValue={details.bankName ?? ""} maxLength={120} />
          </Field>
          <Field label={t("portal.payout.country")} htmlFor="country">
            <Input id="country" name="country" defaultValue={details.country ?? ""} maxLength={60} />
          </Field>
        </div>
      ) : null}
      {current === "other" ? (
        <Field label={t("portal.payout.note")} htmlFor="note" hint={t("portal.payout.noteHint")}>
          <Textarea id="note" name="note" required defaultValue={details.note ?? ""} maxLength={500} className="min-h-20" />
        </Field>
      ) : null}
      <SubmitButton pendingText={t("portal.form.saving")}>{t("portal.payout.save")}</SubmitButton>
    </form>
  );
}

export function AffiliateProfileForm({ slug, name, email, website }: { slug: string; name: string; email: string; website: string }) {
  const t = useT();
  const [state, action] = useActionState(saveAffiliateProfile, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <Field label={t("portal.form.name")} htmlFor="profile-name">
        <Input id="profile-name" name="name" required minLength={2} maxLength={120} defaultValue={name} />
      </Field>
      <Field label={t("portal.form.email")} htmlFor="profile-email" hint={t("portal.profile.emailHint")}>
        <Input id="profile-email" value={email} readOnly disabled dir="ltr" />
      </Field>
      <Field label={t("portal.form.website")} htmlFor="profile-website">
        <Input id="profile-website" name="website" inputMode="url" maxLength={255} defaultValue={website} placeholder="https://" dir="ltr" />
      </Field>
      <SubmitButton pendingText={t("portal.form.saving")}>{t("portal.profile.save")}</SubmitButton>
    </form>
  );
}

export function AffiliatePasswordForm({ slug }: { slug: string }) {
  const t = useT();
  const [state, action] = useActionState(changeAffiliatePassword, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <Field label={t("portal.form.currentPassword")} htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={t("portal.form.newPassword")} htmlFor="new-password" hint={t("portal.form.passwordHint")}>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={200} />
      </Field>
      <Field label={t("portal.form.confirmPassword")} htmlFor="confirm-password">
        <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={200} />
      </Field>
      <SubmitButton pendingText={t("portal.form.saving")}>{t("portal.password.save")}</SubmitButton>
    </form>
  );
}
