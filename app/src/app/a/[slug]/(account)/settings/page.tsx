import { AffiliatePasswordForm, AffiliateProfileForm, PayoutSettingsForm } from "@/components/portal/account-forms";
import { PortalSection } from "@/components/portal/ui";
import { fmtMoney, requireAffiliate } from "@/lib/portal-page";

export const metadata = { title: "Settings" };

export default async function PortalSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t, locale } = await requireAffiliate(slug);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <PortalSection
        title={t("portal.payout.title")}
        description={t("portal.payout.text", { minimum: fmtMoney(program.settings.minPayoutCents, program.currency, locale) })}
        className="lg:row-span-2"
      >
        <PayoutSettingsForm slug={slug} methods={program.settings.payoutMethods} method={affiliate.payoutMethod} details={affiliate.payoutDetails} />
      </PortalSection>
      <PortalSection title={t("portal.profile.title")}>
        <AffiliateProfileForm slug={slug} name={affiliate.name} email={affiliate.email} website={affiliate.website ?? ""} />
      </PortalSection>
      <PortalSection title={t("portal.password.title")}>
        <AffiliatePasswordForm slug={slug} />
      </PortalSection>
    </div>
  );
}
