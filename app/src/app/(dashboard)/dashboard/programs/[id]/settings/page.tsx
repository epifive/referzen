import type { Metadata } from "next";
import Link from "next/link";
import {
  CommissionSettingsForm,
  GeneralSettingsForm,
  NotificationSettingsForm,
  PayoutSettingsForm,
  PortalSettingsForm,
  ProgramDangerZone,
  TrackingSettingsForm,
} from "@/components/dashboard/program-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { getUserChannels } from "@/lib/channels";
import { getT } from "@/lib/i18n/server";
import { requireProgram } from "@/lib/merchant-program";
import { baseUrl } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.settings") };
}

export default async function ProgramSettingsPage({ params }: Props) {
  const { id } = await params;
  const { user, program } = await requireProgram(id);
  const [t, origin, channels, site] = await Promise.all([getT(), baseUrl(), getUserChannels(user.id), getSettings()]);
  const sections = [
    ["general", t("dash.pset.general")],
    ["commission", t("dash.pset.commissionTitle")],
    ["payouts", t("dash.pset.payoutsTitle")],
    ["portal", t("dash.pset.portalTitle")],
    ["tracking", t("dash.pset.trackingTitle")],
    ["notifications", t("dash.pset.notificationsTitle")],
    ["danger", t("dash.pset.dangerTitle")],
  ] as const;

  return (
    <>
      <DashHeader title={t("dash.nav.settings")} description={t("dash.pset.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t("dash.pset.sections")} className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {sections.map(([anchor, label]) => (
              <li key={anchor} className="shrink-0">
                <Link href={`#${anchor}`} className="block rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <Panel id="general" className="scroll-mt-6" title={t("dash.pset.general")} description={t("dash.pset.generalText")}>
            <GeneralSettingsForm
              program={{ id: program.id, name: program.name, slug: program.slug, domain: program.domain, currency: program.currency, extraDomains: program.settings.extraDomains }}
              portalBase={origin.replace(/^https?:\/\//, "")}
            />
          </Panel>
          <Panel id="commission" className="scroll-mt-6" title={t("dash.pset.commissionTitle")} description={t("dash.pset.commissionText")}>
            <CommissionSettingsForm programId={program.id} settings={program.settings} currency={program.currency} />
          </Panel>
          <Panel id="payouts" className="scroll-mt-6" title={t("dash.pset.payoutsTitle")} description={t("dash.pset.payoutsText")}>
            <PayoutSettingsForm programId={program.id} settings={program.settings} currency={program.currency} />
          </Panel>
          <Panel id="portal" className="scroll-mt-6" title={t("dash.pset.portalTitle")} description={t("dash.pset.portalText")}>
            <PortalSettingsForm programId={program.id} settings={program.settings} logoUrl={uploadUrl(program.settings.logo)} primary={site.primary_color} />
          </Panel>
          <Panel id="tracking" className="scroll-mt-6" title={t("dash.pset.trackingTitle")} description={t("dash.pset.trackingText")}>
            <TrackingSettingsForm programId={program.id} settings={program.settings} />
          </Panel>
          <Panel id="notifications" className="scroll-mt-6" title={t("dash.pset.notificationsTitle")} description={t("dash.pset.notificationsText")}>
            <NotificationSettingsForm programId={program.id} settings={program.settings} channels={channels.map((c) => ({ id: c.id, name: c.name, type: c.type, isActive: c.isActive }))} />
          </Panel>
          <Panel id="danger" className="scroll-mt-6 border-red-200 dark:border-red-900/60" title={t("dash.pset.dangerTitle")}>
            <ProgramDangerZone program={{ id: program.id, name: program.name, status: program.status }} />
          </Panel>
        </div>
      </div>
    </>
  );
}
