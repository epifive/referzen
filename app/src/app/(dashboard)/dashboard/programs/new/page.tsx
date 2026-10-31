import type { Metadata } from "next";
import { Crown } from "lucide-react";
import { CreateProgramForm } from "@/components/dashboard/program-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { requireDashboardUser } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { atLimit, getEntitlements } from "@/lib/plans";
import { countUserPrograms } from "@/lib/programs";
import { getSettings } from "@/lib/settings";
import { DEFAULT_PROGRAM_SETTINGS } from "@/referral/types";
import { plural } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.prog.newTitle") };
}

export default async function NewProgramPage() {
  const user = await requireDashboardUser();
  const [t, entitlements, count, settings] = await Promise.all([getT(), getEntitlements(user), countUserPrograms(user.id), getSettings()]);
  const full = atLimit(count, entitlements.maxPrograms);
  return (
    <div className="mx-auto max-w-3xl">
      <DashHeader title={t("dash.prog.newTitle")} description={t("dash.prog.newText")} />
      {full ? (
        <Alert tone="warning" title={t("dash.prog.limitTitle")} className="mb-6">
          <p>{plural(t, "dash.merr.programLimit", entitlements.maxPrograms)}</p>
          <ButtonLink href="/pricing" size="sm" className="mt-3">
            <Crown aria-hidden />
            {t("dash.banner.cta")}
          </ButtonLink>
        </Alert>
      ) : null}
      <Panel>
        <CreateProgramForm defaults={DEFAULT_PROGRAM_SETTINGS} currency={settings.currency || "USD"} atLimit={full} />
      </Panel>
    </div>
  );
}
