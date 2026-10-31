"use client";

import { useActionState, useSyncExternalStore, type ReactNode } from "react";
import { KeyRound, Send, ShieldCheck } from "lucide-react";
import { saveWebhookSecretAction, sendTestEventAction, type TestEventState } from "@/app/actions/dashboard/programs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { HiddenFields, useRefreshingAction } from "./merchant-client";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Accessible tabs for the integration guides; the hash (#stripe, #woocommerce…) selects a tab. */
export function GuideTabs({ tabs, label }: { tabs: Array<{ id: string; label: string; icon?: ReactNode; content: ReactNode }>; label: string }) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const active = tabs.some((tab) => tab.id === hash) ? hash : (tabs[0]?.id ?? "");
  const setActive = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const rtl = document.documentElement.dir === "rtl" || (e.currentTarget as HTMLElement).closest("[dir=rtl]") !== null;
    const step = (e.key === "ArrowRight") !== rtl ? 1 : -1;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line px-3 [scrollbar-width:thin]">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
              active === tab.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={active !== tab.id} className="p-5">
          {tab.content}
        </div>
      ))}
    </div>
  );
}

/** Sends one sample webhook to the program's own URL and shows the answer. */
export function TestEventButton({ programId, sampleId, title, description, canReal }: { programId: number; sampleId: string; title: string; description: string; canReal: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<TestEventState, FormData>(sendTestEventAction, {});
  return (
    <form action={action} className="rounded-lg border border-line p-3">
      <HiddenFields fields={{ program_id: programId, sample_id: sampleId }} />
      <p dir="ltr" className="text-start font-mono text-[13px] font-medium text-ink">
        {title}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{description}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button type="submit" variant="outline" size="sm" disabled={pending} aria-busy={pending}>
          <Send aria-hidden />
          {pending ? t("dash.int.sending") : t("dash.int.sendTest")}
        </Button>
        {canReal ? (
          <Button type="submit" name="real" value="1" variant="ghost" size="sm" disabled={pending} title={t("dash.int.sendRealHint")}>
            {t("dash.int.sendReal")}
          </Button>
        ) : null}
      </div>
      {state.error || state.success ? (
        <div className="mt-3 space-y-2">
          <p role="status" className={cn("text-xs font-medium", state.error ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
            {state.error ?? state.success}
          </p>
          {state.body ? (
            <pre dir="ltr" className="max-h-40 overflow-auto rounded-md bg-paper px-3 py-2 text-start font-mono text-[12px] whitespace-pre-wrap break-all text-muted">
              {state.body}
            </pre>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/**
 * Signing secrets (Stripe whsec_…, WooCommerce / Shopify secret, own HMAC key): one, or several
 * separated by commas. Once saved, every webhook must be signed with one of them.
 */
export function WebhookSecretForm({ programId, hasSecret }: { programId: number; hasSecret: boolean }) {
  const t = useT();
  const [state, action] = useRefreshingAction(saveWebhookSecretAction);
  return (
    <form action={action} className="space-y-3">
      <HiddenFields fields={{ program_id: programId }} />
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        {hasSecret ? <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> : <KeyRound className="size-4 text-muted" aria-hidden />}
        {hasSecret ? t("dash.int.secretOn") : t("dash.int.secretOff")}
      </p>
      <FormMessage state={state} />
      <p id={`secret-hint-${programId}`} className="text-xs text-muted">
        {t("dash.int.secretMulti")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="secret" type="password" dir="ltr" autoComplete="off" placeholder="whsec_…, whsec_…" aria-label={t("dash.int.secretLabel")} aria-describedby={`secret-hint-${programId}`} className="font-mono sm:max-w-sm" />
        <SubmitButton variant="outline" pendingText={t("dash.pset.saving")}>
          {hasSecret ? t("dash.int.secretReplace") : t("dash.int.secretSave")}
        </SubmitButton>
        {hasSecret ? (
          <Button type="submit" name="remove" value="1" variant="ghost" formNoValidate>
            {t("dash.int.secretRemove")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
