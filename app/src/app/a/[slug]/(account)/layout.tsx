import type { ReactNode } from "react";
import { PortalTabs } from "@/components/portal/chrome";
import { Alert } from "@/components/ui/alert";
import { requireAffiliate } from "@/lib/portal-page";

export default async function PortalAccountLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t, availability } = await requireAffiliate(slug);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm text-muted">{t("portal.account.welcome", { name: affiliate.name })}</p>
        <h1 className="mt-1 font-display text-2xl font-bold sm:text-3xl" dir="auto">
          {t("portal.account.title", { program: program.name })}
        </h1>
      </div>
      {availability !== "active" ? (
        <Alert tone="warning" className="mb-6" title={availability === "paused" ? t("portal.paused") : t("portal.unavailable")}>
          {availability === "paused" ? t("portal.pausedText") : t("portal.unavailableText")}
        </Alert>
      ) : null}
      {affiliate.status === "approved" ? <PortalTabs slug={slug} /> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
