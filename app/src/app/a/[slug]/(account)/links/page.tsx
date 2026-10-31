import { redirect } from "next/navigation";
import { LinkBuilder } from "@/components/portal/link-builder";
import { PortalCopyField } from "@/components/portal/copy";
import { PortalSection } from "@/components/portal/ui";
import { defaultLink, requireAffiliate } from "@/lib/portal-page";

export const metadata = { title: "Links" };

export default async function PortalLinks({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t } = await requireAffiliate(slug);
  if (affiliate.status !== "approved") redirect(`/a/${slug}/dashboard`);
  const param = program.settings.refParams[0];
  return (
    <div className="space-y-6">
      <PortalSection title={t("portal.link.title")} description={t("portal.links.defaultText", { domain: program.domain })}>
        <PortalCopyField value={defaultLink(program, affiliate.code)} label={t("portal.link.title")} />
      </PortalSection>
      <PortalSection title={t("portal.links.builderTitle")} description={t("portal.links.builderText")}>
        <LinkBuilder domain={program.domain} code={affiliate.code} param={param} extraDomains={program.settings.extraDomains} />
      </PortalSection>
      <div className="grid gap-6 md:grid-cols-2">
        <PortalSection title={t("portal.link.code")}>
          <PortalCopyField value={affiliate.code} label={t("portal.link.code")} />
          <p className="mt-3 text-sm text-muted">{t("portal.links.codeText", { param, code: affiliate.code })}</p>
        </PortalSection>
        <PortalSection title={t("portal.link.coupon")}>
          {affiliate.couponCode ? (
            <>
              <PortalCopyField value={affiliate.couponCode} label={t("portal.link.coupon")} />
              <p className="mt-3 text-sm text-muted">{t("portal.links.couponText")}</p>
            </>
          ) : (
            <p className="text-sm text-muted">{t("portal.links.noCoupon")}</p>
          )}
        </PortalSection>
      </div>
      <PortalSection title={t("portal.links.tipsTitle")}>
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted">
          <li>{t("portal.links.tip1", { days: program.settings.cookieDays })}</li>
          <li>{t("portal.links.tip2")}</li>
          <li>{t("portal.links.tip3")}</li>
        </ul>
      </PortalSection>
    </div>
  );
}
