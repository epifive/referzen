import type { Metadata } from "next";
import { ArrowDown, ArrowUp, Eye, EyeOff, Megaphone, Trash2 } from "lucide-react";
import { deleteAssetAction, moveAssetAction, toggleAssetAction } from "@/app/actions/dashboard/assets";
import { ActionButton } from "@/components/dashboard/actions";
import { EditAsset, NewAssetPanel } from "@/components/dashboard/asset-forms";
import { ASSET_ICONS } from "@/components/dashboard/merchant-ui";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { getLocale, getT } from "@/lib/i18n/server";
import { fillAssetPlaceholders, listProgramAssets } from "@/lib/merchant-assets";
import { requireProgram } from "@/lib/merchant-program";
import { uploadUrl } from "@/lib/site";
import { referralLink } from "@/referral/normalize";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.assets") };
}

export default async function AssetsPage({ params }: Props) {
  const { id } = await params;
  const { program } = await requireProgram(id);
  const [t, , assets] = await Promise.all([getT(), getLocale(), listProgramAssets(program.id)]);
  const param = program.settings.refParams[0] ?? "ref";
  const sampleCode = "jane";

  return (
    <>
      <DashHeader title={t("dash.nav.assets")} description={t("dash.assets.subtitle")} />
      <div className="mb-6 flex justify-end">
        <NewAssetPanel programId={program.id} domain={program.domain} startOpen={assets.length === 0} />
      </div>

      {assets.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {assets.map((a, i) => {
            const Icon = ASSET_ICONS[a.type];
            const link = referralLink(program.domain, sampleCode, { param, path: a.url || "/" });
            const content = a.content ? fillAssetPlaceholders(a.content, { link, code: sampleCode }) : "";
            const fields = { program_id: program.id, asset_id: a.id };
            return (
              <li key={a.id} className={`flex flex-col rounded-xl border bg-surface ${a.isActive ? "border-line" : "border-dashed border-line opacity-75"}`}>
                <div className="flex items-start gap-3 p-4 pb-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate font-medium">
                      {a.title}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {t(`dash.assets.type.${a.type}`)}
                      {!a.isActive ? <Badge>{t("dash.assets.hidden")}</Badge> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <ActionButton action={moveAssetAction} fields={{ ...fields, direction: "up" }} variant="ghost" label={t("dash.assets.moveUp")} buttonClassName="px-2" className={i === 0 ? "invisible" : undefined}>
                      <ArrowUp aria-hidden />
                    </ActionButton>
                    <ActionButton action={moveAssetAction} fields={{ ...fields, direction: "down" }} variant="ghost" label={t("dash.assets.moveDown")} buttonClassName="px-2" className={i === assets.length - 1 ? "invisible" : undefined}>
                      <ArrowDown aria-hidden />
                    </ActionButton>
                  </div>
                </div>
                <div className="flex-1 px-4">
                  {a.type === "banner" && a.image ? (
                    <div className="mb-3 grid max-h-48 place-items-center overflow-hidden rounded-lg border border-line bg-paper p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={uploadUrl(a.image)} alt={a.title} className="max-h-44 max-w-full object-contain" loading="lazy" />
                    </div>
                  ) : null}
                  {a.type === "link" || a.type === "banner" ? (
                    <p dir="ltr" className="mb-2 truncate rounded-md bg-paper px-2.5 py-1.5 text-start font-mono text-[12px] text-muted" title={link}>
                      {link}
                    </p>
                  ) : null}
                  {content ? (
                    <p dir="auto" className={`text-sm whitespace-pre-line text-muted ${a.type === "email" ? "line-clamp-6" : "line-clamp-4"}`}>
                      {content}
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                  <EditAsset
                    programId={program.id}
                    domain={program.domain}
                    asset={{ id: a.id, type: a.type, title: a.title, url: a.url, image: a.image, imageUrl: a.image ? uploadUrl(a.image) : "", content: a.content, isActive: a.isActive }}
                  />
                  <ActionButton action={toggleAssetAction} fields={{ ...fields, active: a.isActive ? "0" : "1" }} variant="ghost">
                    {a.isActive ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    {a.isActive ? t("dash.assets.hide") : t("dash.assets.show")}
                  </ActionButton>
                  <ActionButton action={deleteAssetAction} fields={fields} variant="ghost" confirmText={t("dash.assets.deleteConfirm", { title: a.title })} className="ms-auto" label={t("dash.assets.delete")}>
                    <Trash2 aria-hidden />
                  </ActionButton>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Panel>
          <Empty icon={<Megaphone />} title={t("dash.assets.emptyTitle")}>
            {t("dash.assets.emptyText")}
          </Empty>
        </Panel>
      )}
      <p className="mt-4 text-xs text-muted">{t("dash.assets.previewNote", { code: sampleCode })}</p>
    </>
  );
}
