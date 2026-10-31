"use client";

import { useActionState } from "react";
import Link from "next/link";
import { affiliateForgotPassword, affiliateLogin, affiliateResetPassword, affiliateSignup } from "@/app/actions/portal/auth";
import { initialFormState } from "@/app/actions/types";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export function AffiliateSignupForm({ slug, hasTerms, demo }: { slug: string; hasTerms: boolean; demo?: boolean }) {
  const t = useT();
  const [state, action] = useActionState(affiliateSignup, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden className="absolute -start-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <Field label={t("portal.form.name")} htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} disabled={demo} />
      </Field>
      <Field label={t("portal.form.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={190} dir="ltr" disabled={demo} />
      </Field>
      <Field label={t("portal.form.password")} htmlFor="password" hint={t("portal.form.passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={200} disabled={demo} />
      </Field>
      <Field label={t("portal.form.website")} htmlFor="website" hint={t("portal.form.websiteHint")}>
        <Input id="website" name="website" type="text" inputMode="url" autoComplete="url" maxLength={255} placeholder="https://" dir="ltr" disabled={demo} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="terms" required className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" disabled={demo} />
        <span>
          {hasTerms ? (
            <>
              {t("portal.form.acceptTerms")}{" "}
              <Link href={`/a/${slug}#terms`} target="_blank" className="text-primary-text underline underline-offset-2">
                {t("portal.landing.terms")}
              </Link>
            </>
          ) : (
            t("portal.form.acceptRules")
          )}
        </span>
      </label>
      <SubmitButton className="w-full" pendingText={t("portal.form.creating")}>
        {t("portal.signup.submit")}
      </SubmitButton>
    </form>
  );
}

export function AffiliateLoginForm({ slug, demo }: { slug: string; demo?: { email: string; password: string } }) {
  const t = useT();
  const [state, action] = useActionState(affiliateLogin, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <Field label={t("portal.form.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" defaultValue={demo?.email} />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between gap-3">
            {t("portal.form.password")}
            <Link href={`/a/${slug}/forgot`} className="text-xs font-normal text-primary-text hover:underline">
              {t("portal.login.forgot")}
            </Link>
          </span>
        }
        htmlFor="password"
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo?.password} />
      </Field>
      <SubmitButton className="w-full" pendingText={t("portal.form.signingIn")}>
        {t("portal.login.submit")}
      </SubmitButton>
    </form>
  );
}

export function AffiliateForgotForm({ slug }: { slug: string }) {
  const t = useT();
  const [state, action] = useActionState(affiliateForgotPassword, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <Field label={t("portal.form.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>
      <SubmitButton className="w-full" pendingText={t("portal.form.sending")}>
        {t("portal.forgot.submit")}
      </SubmitButton>
    </form>
  );
}

export function AffiliateResetForm({ slug, token, firstPassword }: { slug: string; token: string; firstPassword: boolean }) {
  const t = useT();
  const [state, action] = useActionState(affiliateResetPassword, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <Field label={t("portal.form.newPassword")} htmlFor="password" hint={t("portal.form.passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={200} />
      </Field>
      <Field label={t("portal.form.confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={200} />
      </Field>
      <SubmitButton className="w-full" pendingText={t("portal.form.saving")}>
        {firstPassword ? t("portal.reset.submitFirst") : t("portal.reset.submit")}
      </SubmitButton>
    </form>
  );
}
