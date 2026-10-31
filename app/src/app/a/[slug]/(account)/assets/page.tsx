import { redirect } from "next/navigation";
import { Image as ImageIcon, Link2, Mail, Type } from "lucide-react";
import { PortalCopyButton, PortalCopyField } from "@/components/portal/copy";
import { EmptyNote, PortalSection } from "@/components/portal/ui";
import { fillAssetPlaceholders, listProgramAssets, type AssetRecord } from "@/lib/merchant-assets";
import { defaultLink, requireAffiliate } from "@/lib/portal-page";
import { getSettings } from "@/lib/settings";
import { absoluteUrl, uploadUrl } from "@/lib/site";
import type { MessageKey } from "@/lib/i18n/messages";

export const metadata = { title: "Marketing assets" };

const ICONS = { link: Link2, banner: ImageIcon, text: Type, email: Mail } as const;

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function PortalAssets({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t } = await requireAffiliate(slug);
  if (affiliate.status !== "approved") redirect(`/a/${slug}/dashboard`);
  const [assets, settings] = await Promise.all([listProgramAssets(program.id, { activeOnly: true }), getSettings()]);
  const linkFor = (asset: AssetRecord) => defaultLink(program, affiliate.code, asset.url);
  const imageUrl = (image: string) => {
    const url = uploadUrl(image);
    return url.startsWith("/") ? absoluteUrl(settings, url) : url;
  };

  if (!assets.length) {
    return (
      <PortalSection title={t("portal.assets.title")}>
        <EmptyNote>{t("portal.assets.empty")}</EmptyNote>
      </PortalSection>
    );
  }

  return (
    <div className="space-y-4" id="portal-assets">
      <p className="text-sm text-muted">{t("portal.assets.intro")}</p>
      {assets.map((asset) => {
        const Icon = ICONS[asset.type];
        const link = linkFor(asset);
                return (
          <PortalSection
            key={asset.id}
            title={
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-primary-text" aria-hidden />
                <span dir="auto">{asset.title}</span>
              </span>
            }
            actions={<span className="rounded-full bg-paper px-2 py-0.5 text-xs text-muted">{t(`portal.assets.type.${asset.type}` as MessageKey)}</span>}
          >
            {asset.type === "link" ? <PortalCopyField value={link} label={asset.title} /> : null}
            {asset.type === "banner" && asset.image ? (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-lg border border-dashed border-line bg-paper p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- merchant-uploaded banner of any size */}
                  <img src={uploadUrl(asset.image)} alt={asset.title} className="mx-auto h-auto max-h-64 w-auto max-w-full object-contain" loading="lazy" />
                </div>
                <PortalCopyField
                  multiline
                  value={`<a href="${escapeAttr(link)}" target="_blank" rel="noopener"><img src="${escapeAttr(imageUrl(asset.image))}" alt="${escapeAttr(asset.title)}" /></a>`}
                  label={t("portal.assets.html")}
                />
                <div className="flex flex-wrap gap-2">
                  <PortalCopyButton text={link} label={t("portal.assets.copyLink")} />
                  <a href={uploadUrl(asset.image)} download className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line hover:text-primary-text">
                    {t("portal.assets.download")}
                  </a>
                </div>
              </div>
            ) : null}
            {asset.type === "text" || asset.type === "email" ? <PortalCopyField multiline value={fillAssetPlaceholders(asset.content ?? "", { link, code: affiliate.code }).replace(/\{coupon\}/g, affiliate.couponCode ?? "").replace(/\{name\}/g, affiliate.name)} label={asset.title} /> : null}
          </PortalSection>
        );
      })}
    </div>
  );
}
