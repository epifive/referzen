"use client";

import { useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import type { FormState } from "@/app/actions/types";
import { saveAssetAction } from "@/app/actions/dashboard/assets";
import { Button } from "@/components/ui/button";
import { Field, Hint, Input, Label, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n/client";
import type { AssetType } from "@/referral/types";
import { HiddenFields, useRefreshingAction } from "./merchant-client";

import { ASSET_ICONS } from "./merchant-ui";

export interface AssetFormValue {
  id: number;
  type: AssetType;
  title: string;
  url: string;
  image: string | null;
  imageUrl: string;
  content: string | null;
  isActive: boolean;
}

/** Create (no `asset`) or edit a marketing asset. */
export function AssetForm({ programId, domain, asset, onDone }: { programId: number; domain: string; asset?: AssetFormValue; onDone?: () => void }) {
  const t = useT();
  const [type, setType] = useState<AssetType>(asset?.type ?? "link");
  const [formKey, setFormKey] = useState(0);
  const [fileName, setFileName] = useState("");
  const [state, action] = useRefreshingAction(async (prev: FormState, fd: FormData) => {
    const result = await saveAssetAction(prev, fd);
    if (!result.error && !asset) {
      setFormKey((k) => k + 1);
      setFileName("");
    }
    if (!result.error) onDone?.();
    return result;
  });
  const prefix = asset ? `a${asset.id}` : "an";
  return (
    <form key={formKey} action={action} className="space-y-4">
      <HiddenFields fields={asset ? { program_id: programId, asset_id: asset.id } : { program_id: programId, type }} />
      <FormMessage state={state} />
      {!asset ? (
        <div>
          <Label>{t("dash.assets.type")}</Label>
          <Segmented<AssetType>
            value={type}
            onChange={setType}
            label={t("dash.assets.type")}
            options={(["link", "banner", "text", "email"] as const).map((v) => {
              const Icon = ASSET_ICONS[v];
              return {
                value: v,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="size-4" aria-hidden />
                    {t(`dash.assets.type.${v}`)}
                  </span>
                ),
              };
            })}
          />
          <Hint>{t(`dash.assets.typeHint.${type}`)}</Hint>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={type === "email" ? t("dash.assets.subject") : t("dash.assets.title")} htmlFor={`${prefix}-title`}>
          <Input id={`${prefix}-title`} name="title" required maxLength={160} dir="auto" defaultValue={asset?.title ?? ""} placeholder={type === "email" ? t("dash.assets.subjectPlaceholder") : t("dash.assets.titlePlaceholder")} />
        </Field>
        {type === "link" || type === "banner" ? (
          <Field label={t("dash.assets.url")} htmlFor={`${prefix}-url`} hint={t("dash.assets.urlHint", { domain })}>
            <Input id={`${prefix}-url`} name="url" maxLength={1000} dir="ltr" defaultValue={asset?.url ?? ""} placeholder="/pricing?utm_source=affiliate&utm_medium=banner" />
          </Field>
        ) : null}
      </div>
      {type === "banner" ? (
        <div>
          <Label htmlFor={`${prefix}-file`}>{t("dash.assets.image")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="inline-flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:border-primary-line hover:text-primary">
              <Upload className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{fileName || t("dash.pset.upload")}</span>
              <input id={`${prefix}-file`} type="file" name="image_file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
            </label>
            <span className="text-xs text-muted">{t("dash.assets.or")}</span>
            <Input name="image_url" dir="ltr" maxLength={1000} placeholder="https://cdn.example.com/banner-728x90.png" defaultValue={asset?.image && /^https?:/.test(asset.image) ? asset.image : ""} aria-label={t("dash.assets.imageUrl")} className="sm:flex-1" />
          </div>
          <Hint>{t("dash.assets.imageHint")}</Hint>
        </div>
      ) : null}
      <Field
        label={type === "email" ? t("dash.assets.body") : type === "text" ? t("dash.assets.text") : t("dash.assets.description")}
        htmlFor={`${prefix}-content`}
        hint={t("dash.assets.placeholders")}
      >
        <Textarea
          id={`${prefix}-content`}
          name="content"
          rows={type === "email" ? 8 : type === "text" ? 4 : 2}
          maxLength={10000}
          dir="auto"
          required={type === "text" || type === "email"}
          defaultValue={asset?.content ?? ""}
          placeholder={type === "email" ? t("dash.assets.bodyPlaceholder") : type === "text" ? t("dash.assets.textPlaceholder") : ""}
          className={type === "link" || type === "banner" ? "min-h-16" : undefined}
        />
      </Field>
      {asset ? <Switch name="active" defaultChecked={asset.isActive} label={t("dash.assets.active")} description={t("dash.assets.activeHint")} /> : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText={t("dash.pset.saving")}>{asset ? t("dash.pset.save") : t("dash.assets.add")}</SubmitButton>
        {onDone ? (
          <Button variant="ghost" onClick={onDone}>
            {t("dash.assets.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** "New asset" button that unfolds the create form. */
export function NewAssetPanel({ programId, domain, startOpen }: { programId: number; domain: string; startOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("dash.assets.new")}
      </Button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-primary-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{t("dash.assets.newTitle")}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("nav.closeMenu")} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <AssetForm programId={programId} domain={domain} />
    </div>
  );
}

/** Edit toggle shown on an asset card. */
export function EditAsset({ programId, domain, asset }: { programId: number; domain: string; asset: AssetFormValue }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("dash.assets.edit")}
      </Button>
    );
  }
  return (
    <div className="mt-4 w-full basis-full border-t border-line pt-4">
      <AssetForm programId={programId} domain={domain} asset={asset} onDone={() => setOpen(false)} />
    </div>
  );
}
