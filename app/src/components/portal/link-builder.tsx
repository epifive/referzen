"use client";

import { useMemo, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";
import { hostMatches, referralLink } from "@/referral/normalize";
import { PortalCopyField } from "./copy";

/** Builds a referral link to any page of the merchant's website, with an optional campaign sub-id. */
export function LinkBuilder({ domain, code, param, extraDomains }: { domain: string; code: string; param: string; extraDomains: string[] }) {
  const t = useT();
  const [page, setPage] = useState("");
  const [sub, setSub] = useState("");

  const result = useMemo(() => {
    const raw = page.trim();
    if (/^https?:\/\//i.test(raw)) {
      try {
        const host = new URL(raw).hostname;
        if (![domain, ...extraDomains].some((d) => hostMatches(host, d))) return { error: t("portal.links.otherDomain", { domain }) };
      } catch {
        return { error: t("portal.links.invalid") };
      }
    }
    return { link: referralLink(domain, code, { param, path: raw, subId: sub }) };
  }, [page, sub, domain, code, param, extraDomains, t]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr]">
        <Field label={t("portal.links.page")} htmlFor="lb-page" hint={t("portal.links.pageHint", { domain })}>
          <Input id="lb-page" value={page} onChange={(e) => setPage(e.target.value)} placeholder="/pricing" dir="ltr" maxLength={500} />
        </Field>
        <Field label={t("portal.links.sub")} htmlFor="lb-sub" hint={t("portal.links.subHint")}>
          <Input id="lb-sub" value={sub} onChange={(e) => setSub(e.target.value.replace(/[^A-Za-z0-9 _.:/-]/g, "").slice(0, 60))} placeholder="youtube" dir="ltr" maxLength={60} />
        </Field>
      </div>
      {"error" in result ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {result.error}
        </p>
      ) : (
        <PortalCopyField id="link-builder-output" value={result.link ?? ""} label={t("portal.links.result")} />
      )}
    </div>
  );
}
