"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Loader2, Pause, Play, Trash2, TriangleAlert, Upload } from "lucide-react";
import { initialFormState } from "@/app/actions/types";
import {
  checkSlugAction,
  createProgramAction,
  deleteProgramAction,
  saveProgramSettingsAction,
  setProgramStatusAction,
} from "@/app/actions/dashboard/programs";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Hint, Input, Label, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { currencyDecimals, fromMinorUnits, normalizeSlug } from "@/referral/normalize";
import { NOTIFY_EVENTS, PAYOUT_METHODS, type CommissionType, type ProgramSettings, type RecurringMode } from "@/referral/types";
import { ActionButton } from "./actions";
import { HiddenFields, useRefreshingAction } from "./merchant-client";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "INR", "JPY", "SGD", "HKD", "AED", "SAR", "ZAR", "BRL", "MXN", "TRY", "IDR", "MYR", "PHP"];

/** Minor units → plain decimal string for inputs ("49.00" → "49", "12.5"). */
export function majorString(cents: number, currency: string): string {
  const v = fromMinorUnits(cents, currency);
  return Number.isInteger(v) ? String(v) : v.toFixed(currencyDecimals(currency));
}

function CurrencySelect({ id, value, name = "currency", onChange }: { id: string; value?: string; name?: string; onChange?: (v: string) => void }) {
  const list = value && !CURRENCIES.includes(value) ? [value, ...CURRENCIES] : CURRENCIES;
  return (
    <Select id={id} name={name} defaultValue={value ?? "USD"} onChange={(e) => onChange?.(e.target.value)} dir="ltr">
      {list.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}

/** An input with a fixed suffix/prefix ("%", "USD", "days"). */
function Affixed({ children, affix, position = "end" }: { children: React.ReactNode; affix: string; position?: "start" | "end" }) {
  const box = <span dir="ltr" className={cn("inline-flex h-10 shrink-0 items-center border border-line bg-paper px-3 text-sm text-muted", position === "end" ? "rounded-e-lg border-s-0" : "rounded-s-lg border-e-0")}>{affix}</span>;
  return (
    <div className="flex">
      {position === "start" ? box : null}
      <div className={cn("min-w-0 flex-1 [&_input]:rounded-none", position === "end" ? "[&_input]:rounded-s-lg" : "[&_input]:rounded-e-lg")}>{children}</div>
      {position === "end" ? box : null}
    </div>
  );
}

/** Commission type, rate and recurring rule (create form and settings). */
function CommissionFields({ settings, currency, idPrefix }: { settings: Pick<ProgramSettings, "commissionType" | "rate" | "recurring">; currency: string; idPrefix: string }) {
  const t = useT();
  const [type, setType] = useState<CommissionType>(settings.commissionType);
  const [mode, setMode] = useState<RecurringMode>(settings.recurring.mode);
  const defaultRate = settings.commissionType === "percent" ? String(settings.rate / 100) : majorString(settings.rate, currency);
  return (
    <div className="space-y-5">
      <div>
        <Label>{t("dash.pset.commissionType")}</Label>
        <input type="hidden" name="commissionType" value={type} />
        <Segmented<CommissionType>
          value={type}
          onChange={setType}
          label={t("dash.pset.commissionType")}
          options={[
            { value: "percent", label: t("dash.pset.typePercent") },
            { value: "fixed", label: t("dash.pset.typeFixed") },
          ]}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={type === "percent" ? t("dash.pset.ratePercent") : t("dash.pset.rateFixed")} htmlFor={`${idPrefix}-rate`} hint={type === "percent" ? t("dash.pset.ratePercentHint") : t("dash.pset.rateFixedHint")}>
          <Affixed affix={type === "percent" ? "%" : currency}>
            <Input
              key={type}
              id={`${idPrefix}-rate`}
              name="rate"
              required
              inputMode="decimal"
              dir="ltr"
              defaultValue={type === settings.commissionType ? defaultRate : type === "percent" ? "20" : "10"}
            />
          </Affixed>
        </Field>
        <Field label={t("dash.pset.recurring")} htmlFor={`${idPrefix}-recurring`} hint={t("dash.pset.recurringHint")}>
          <Select id={`${idPrefix}-recurring`} name="recurringMode" value={mode} onChange={(e) => setMode(e.target.value as RecurringMode)}>
            <option value="none">{t("dash.pset.recurringNone")}</option>
            <option value="months">{t("dash.pset.recurringMonths")}</option>
            <option value="lifetime">{t("dash.pset.recurringLifetime")}</option>
          </Select>
        </Field>
      </div>
      {mode === "months" ? (
        <Field label={t("dash.pset.months")} htmlFor={`${idPrefix}-months`} hint={t("dash.pset.monthsHint")} className="sm:max-w-[calc(50%-0.625rem)]">
          <Affixed affix={t("dash.pset.monthsUnit")}>
            <Input id={`${idPrefix}-months`} name="recurringMonths" type="number" min={1} max={120} required dir="ltr" defaultValue={settings.recurring.months} />
          </Affixed>
        </Field>
      ) : (
        <input type="hidden" name="recurringMonths" value={settings.recurring.months} />
      )}
    </div>
  );
}

export function CreateProgramForm({ defaults, currency, atLimit }: { defaults: Pick<ProgramSettings, "commissionType" | "rate" | "recurring">; currency: string; atLimit: boolean }) {
  const t = useT();
  const [state, action] = useActionState(createProgramAction, initialFormState);
  const [cur, setCur] = useState(currency);
  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      <fieldset disabled={atLimit} className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("dash.pset.name")} htmlFor="np-name" hint={t("dash.prog.nameHint")}>
            <Input id="np-name" name="name" maxLength={120} dir="auto" placeholder={t("dash.prog.namePlaceholder")} />
          </Field>
          <Field label={t("dash.pset.domain")} htmlFor="np-domain" hint={t("dash.prog.domainHint")}>
            <Affixed affix="https://" position="start">
              <Input id="np-domain" name="domain" required dir="ltr" placeholder="example.com" autoComplete="off" />
            </Affixed>
          </Field>
        </div>
        <Field label={t("dash.pset.currency")} htmlFor="np-currency" hint={t("dash.prog.currencyHint")} className="sm:max-w-[calc(50%-0.625rem)]">
          <CurrencySelect id="np-currency" value={currency} onChange={setCur} />
        </Field>
        <div className="rounded-xl border border-line bg-paper/60 p-4 sm:p-5">
          <p className="mb-4 text-sm font-semibold">{t("dash.pset.commissionTitle")}</p>
          <CommissionFields settings={defaults} currency={cur} idPrefix="np" />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText={t("dash.prog.creating")}>{t("dash.prog.create")}</SubmitButton>
        <p className="text-xs text-muted">{t("dash.prog.createNote")}</p>
      </div>
    </form>
  );
}

function SectionForm({ programId, section, children, className }: { programId: number; section: string; children: React.ReactNode; className?: string }) {
  const t = useT();
  const [state, action] = useRefreshingAction(saveProgramSettingsAction);
  return (
    <form action={action} className={cn("space-y-5", className)}>
      <HiddenFields fields={{ program_id: programId, section }} />
      <FormMessage state={state} />
      {children}
      <SubmitButton pendingText={t("dash.pset.saving")}>{t("dash.pset.save")}</SubmitButton>
    </form>
  );
}

type SlugState = "idle" | "checking" | "ok" | "taken" | "invalid";

export function GeneralSettingsForm({
  program,
  portalBase,
}: {
  program: { id: number; name: string; slug: string; domain: string; currency: string; extraDomains: string[] };
  portalBase: string;
}) {
  const t = useT();
  const [slug, setSlug] = useState(program.slug);
  const [slugState, setSlugState] = useState<SlugState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);

  const onSlug = (value: string) => {
    setSlug(value);
    clearTimeout(timer.current);
    const clean = normalizeSlug(value);
    if (!clean) {
      setSlugState("invalid");
      return;
    }
    if (clean === program.slug) {
      setSlugState("idle");
      return;
    }
    setSlugState("checking");
    const n = ++seq.current;
    timer.current = setTimeout(async () => {
      const res = await checkSlugAction(program.id, value);
      if (n === seq.current) setSlugState(res.slug ? (res.available ? "ok" : "taken") : "invalid");
    }, 350);
  };
  const preview = normalizeSlug(slug) || slug;

  return (
    <SectionForm programId={program.id} section="general">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("dash.pset.name")} htmlFor="ps-name">
          <Input id="ps-name" name="name" required maxLength={120} dir="auto" defaultValue={program.name} />
        </Field>
        <Field label={t("dash.pset.currency")} htmlFor="ps-currency" hint={t("dash.pset.currencyHint")}>
          <CurrencySelect id="ps-currency" value={program.currency} />
        </Field>
      </div>
      <Field label={t("dash.pset.slug")} htmlFor="ps-slug">
        <Affixed affix={`${portalBase}/a/`} position="start">
          <Input id="ps-slug" name="slug" required maxLength={40} dir="ltr" value={slug} onChange={(e) => onSlug(e.target.value)} autoComplete="off" aria-describedby="ps-slug-status" />
        </Affixed>
        <p id="ps-slug-status" className="mt-1.5 flex items-center gap-1.5 text-xs" aria-live="polite">
          {slugState === "checking" ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("dash.pset.slugChecking")}
            </span>
          ) : slugState === "ok" ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="size-3.5" aria-hidden />
              {t("dash.pset.slugAvailable", { slug: preview })}
            </span>
          ) : slugState === "taken" ? (
            <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <CircleX className="size-3.5" aria-hidden />
              {t("dash.pset.slugTaken")}
            </span>
          ) : slugState === "invalid" ? (
            <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <CircleX className="size-3.5" aria-hidden />
              {t("dash.merr.slug")}
            </span>
          ) : (
            <span className="text-muted">{t("dash.pset.slugHint")}</span>
          )}
        </p>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("dash.pset.domain")} htmlFor="ps-domain" hint={t("dash.pset.domainHint")}>
          <Input id="ps-domain" name="domain" required dir="ltr" defaultValue={program.domain} />
        </Field>
        <Field label={t("dash.pset.extraDomains")} htmlFor="ps-extra" hint={t("dash.pset.extraDomainsHint")}>
          <Textarea id="ps-extra" name="extraDomains" dir="ltr" rows={2} className="min-h-10 font-mono text-[13px]" defaultValue={program.extraDomains.join("\n")} placeholder="checkout.example.com" />
        </Field>
      </div>
    </SectionForm>
  );
}

export function CommissionSettingsForm({ programId, settings, currency }: { programId: number; settings: ProgramSettings; currency: string }) {
  const t = useT();
  return (
    <SectionForm programId={programId} section="commission">
      <CommissionFields settings={settings} currency={currency} idPrefix="pc" />
      <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
        <Field label={t("dash.pset.cookieDays")} htmlFor="pc-cookie" hint={t("dash.pset.cookieDaysHint")}>
          <Affixed affix={t("dash.pset.daysUnit")}>
            <Input id="pc-cookie" name="cookieDays" type="number" min={1} max={365} required dir="ltr" defaultValue={settings.cookieDays} />
          </Affixed>
        </Field>
        <Field label={t("dash.pset.holdDays")} htmlFor="pc-hold" hint={t("dash.pset.holdDaysHint")}>
          <Affixed affix={t("dash.pset.daysUnit")}>
            <Input id="pc-hold" name="holdDays" type="number" min={0} max={365} required dir="ltr" defaultValue={settings.holdDays} />
          </Affixed>
        </Field>
      </div>
    </SectionForm>
  );
}

export function PayoutSettingsForm({ programId, settings, currency }: { programId: number; settings: ProgramSettings; currency: string }) {
  const t = useT();
  return (
    <SectionForm programId={programId} section="payouts">
      <Field label={t("dash.pset.minPayout")} htmlFor="pp-min" hint={t("dash.pset.minPayoutHint")} className="sm:max-w-[calc(50%-0.625rem)]">
        <Affixed affix={currency}>
          <Input id="pp-min" name="minPayout" inputMode="decimal" dir="ltr" defaultValue={majorString(settings.minPayoutCents, currency)} />
        </Affixed>
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("dash.pset.payoutMethods")}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {PAYOUT_METHODS.map((m) => (
            <Checkbox key={m} name="payoutMethods" value={m} defaultChecked={settings.payoutMethods.includes(m)} label={t(`dash.pay.method.${m}` as MessageKey)} />
          ))}
        </div>
        <Hint>{t("dash.pset.payoutMethodsHint")}</Hint>
      </fieldset>
      <div className="rounded-lg border border-line p-4">
        <Switch name="autoApprove" defaultChecked={settings.autoApprove} label={t("dash.pset.autoApprove")} description={t("dash.pset.autoApproveHint")} />
      </div>
    </SectionForm>
  );
}

export function PortalSettingsForm({ programId, settings, logoUrl, primary }: { programId: number; settings: ProgramSettings; logoUrl: string; primary: string }) {
  const t = useT();
  const [color, setColor] = useState(settings.brandColor);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [fileName, setFileName] = useState("");
  return (
    <SectionForm programId={programId} section="portal">
      <Field label={t("dash.pset.headline")} htmlFor="pt-headline" hint={t("dash.pset.headlineHint")}>
        <Input id="pt-headline" name="portalHeadline" maxLength={120} dir="auto" defaultValue={settings.portalHeadline} placeholder={t("dash.pset.headlinePlaceholder")} />
      </Field>
      <Field label={t("dash.pset.intro")} htmlFor="pt-intro" hint={t("dash.pset.introHint")}>
        <Textarea id="pt-intro" name="portalIntro" maxLength={1000} rows={3} dir="auto" defaultValue={settings.portalIntro} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("dash.pset.brandColor")} htmlFor="pt-color" hint={t("dash.pset.brandColorHint")}>
          <div className="flex gap-2">
            <input
              type="color"
              aria-label={t("dash.pset.brandColorPick")}
              value={color || primary}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
            />
            <Input id="pt-color" name="brandColor" dir="ltr" maxLength={7} value={color} onChange={(e) => setColor(e.target.value)} placeholder={primary} className="font-mono" />
            {color ? (
              <Button variant="ghost" onClick={() => setColor("")} className="shrink-0">
                {t("dash.pset.reset")}
              </Button>
            ) : null}
          </div>
        </Field>
        <div>
          <Label htmlFor="pt-logo-file">{t("dash.pset.logo")}</Label>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl && !removeLogo ? <img src={logoUrl} alt="" className="max-h-8 max-w-20 object-contain" /> : <span className="text-[11px] text-muted">{t("dash.pset.noLogo")}</span>}
            </span>
            <label className="inline-flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:border-primary-line hover:text-primary">
              <Upload className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{fileName || t("dash.pset.upload")}</span>
              <input id="pt-logo-file" type="file" name="logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
            </label>
            {logoUrl ? (
              <Checkbox name="remove_logo" value="1" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} label={t("dash.pset.removeLogo")} />
            ) : null}
          </div>
          <Input name="logo_url" dir="ltr" className="mt-2" placeholder={t("dash.pset.logoUrlPlaceholder")} aria-label={t("dash.pset.logoUrl")} defaultValue={/^https?:/.test(settings.logo) ? settings.logo : ""} />
          <Hint>{t("dash.pset.logoHint")}</Hint>
        </div>
      </div>
      <Field label={t("dash.pset.terms")} htmlFor="pt-terms" hint={t("dash.pset.termsHint")}>
        <Textarea id="pt-terms" name="terms" rows={8} dir="auto" maxLength={20000} defaultValue={settings.terms} placeholder={t("dash.pset.termsPlaceholder")} />
      </Field>
    </SectionForm>
  );
}

export function TrackingSettingsForm({ programId, settings }: { programId: number; settings: ProgramSettings }) {
  const t = useT();
  return (
    <SectionForm programId={programId} section="tracking">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("dash.pset.refParams")} htmlFor="pk-params" hint={t("dash.pset.refParamsHint")}>
          <Input id="pk-params" name="refParams" dir="ltr" required defaultValue={settings.refParams.join(", ")} className="font-mono" />
        </Field>
        <Field label={t("dash.pset.leadEmail")} htmlFor="pk-lead" hint={t("dash.pset.leadEmailHint")}>
          <Select id="pk-lead" name="leadEmailMode" defaultValue={settings.leadEmailMode}>
            <option value="plain">{t("dash.pset.leadPlain")}</option>
            <option value="hashed">{t("dash.pset.leadHashed")}</option>
          </Select>
        </Field>
      </div>
      <div className="space-y-4 rounded-lg border border-line p-4">
        <Switch name="allowClientConversions" defaultChecked={settings.allowClientConversions} label={t("dash.pset.clientConversions")} description={t("dash.pset.clientConversionsHint")} />
        <Switch name="allowLocalhost" defaultChecked={settings.allowLocalhost} label={t("dash.pset.localhost")} description={t("dash.pset.localhostHint")} />
      </div>
    </SectionForm>
  );
}

export function NotificationSettingsForm({ programId, settings, channels }: { programId: number; settings: ProgramSettings; channels: Array<{ id: number; name: string; type: string; isActive: boolean }> }) {
  const t = useT();
  return (
    <SectionForm programId={programId} section="notifications">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("dash.pset.events")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {NOTIFY_EVENTS.map((e) => (
            <Checkbox key={e} name="notifyEvents" value={e} defaultChecked={settings.notifyEvents.includes(e)} label={t(`dash.pset.event.${e}` as MessageKey)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("dash.pset.channels")}</legend>
        {channels.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => (
              <Checkbox
                key={c.id}
                name="alertChannelIds"
                value={c.id}
                defaultChecked={settings.alertChannelIds.includes(c.id)}
                label={
                  <span>
                    <span dir="auto">{c.name}</span> <span className="text-xs text-muted">({t(`dash.channels.type.${c.type}` as MessageKey)}{c.isActive ? "" : `, ${t("dash.pset.channelOff")}`})</span>
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("dash.pset.noChannels")}</p>
        )}
        <Hint>
          {t("dash.pset.channelsHint")}{" "}
          <Link href="/dashboard/channels/new" className="font-medium text-primary hover:underline">
            {t("dash.pset.addChannel")}
          </Link>
        </Hint>
      </fieldset>
      <div className="rounded-lg border border-line p-4">
        <Switch name="emailAffiliates" defaultChecked={settings.emailAffiliates} label={t("dash.pset.emailAffiliates")} description={t("dash.pset.emailAffiliatesHint")} />
      </div>
    </SectionForm>
  );
}

export function ProgramDangerZone({ program }: { program: { id: number; name: string; status: "active" | "paused" } }) {
  const t = useT();
  const [confirm, setConfirm] = useState("");
  const [state, action] = useActionState(deleteProgramAction, initialFormState);
  const paused = program.status === "paused";
  return (
    <div className="divide-y divide-line">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
        <div className="max-w-xl">
          <p className="text-sm font-medium">{paused ? t("dash.pset.resumeTitle") : t("dash.pset.pauseTitle")}</p>
          <p className="mt-0.5 text-sm text-muted">{paused ? t("dash.pset.resumeText") : t("dash.pset.pauseText")}</p>
          <p className="mt-2 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{t("dash.pset.pauseWebhooks")}</span>
          </p>
        </div>
        <ActionButton
          action={setProgramStatusAction}
          fields={{ program_id: program.id, status: paused ? "active" : "paused" }}
          confirmText={paused ? undefined : t("dash.pset.pauseConfirm")}
          size="md"
          variant={paused ? "primary" : "outline"}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? t("dash.pset.resume") : t("dash.pset.pause")}
        </ActionButton>
      </div>
      <form action={action} className="space-y-3 pt-5">
        <input type="hidden" name="program_id" value={program.id} />
        <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("dash.pset.deleteTitle")}</p>
        <p className="text-sm text-muted">{t("dash.pset.deleteText")}</p>
        <FormMessage state={state} />
        <Label htmlFor="pd-confirm" className="font-normal text-muted">
          {t("dash.pset.deleteLabel", { name: program.name })}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="pd-confirm" name="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="auto" autoComplete="off" placeholder={program.name} className="sm:max-w-xs" />
          <Button type="submit" variant="danger" disabled={confirm.trim() !== program.name.trim()}>
            <Trash2 aria-hidden />
            {t("dash.pset.delete")}
          </Button>
        </div>
      </form>
    </div>
  );
}
