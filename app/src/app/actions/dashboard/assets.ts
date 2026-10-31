"use server";

import { saveUpload } from "@/lib/admin";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/messages";
import {
  countProgramAssets,
  createAsset,
  deleteAsset,
  getOwnedAsset,
  isAssetType,
  MAX_ASSETS_PER_PROGRAM,
  moveAsset,
  normalizeAssetUrl,
  setAssetActive,
  updateAsset,
  type AssetInput,
} from "@/lib/merchant-assets";
import { getOwnedProgram, type ProgramRecord } from "@/lib/programs";
import { str as clean, text } from "@/referral/normalize";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

type Owned = { ok: true; program: ProgramRecord; t: Translator } | { ok: false; error: string };

async function owned(formData: FormData): Promise<Owned> {
  const guard = await guardDashboard();
  if (!guard.ok) return guard;
  const t = await getT();
  const program = await getOwnedProgram(idOf(formData.get("program_id")), guard.user.id);
  if (!program) return { ok: false, error: t("dash.merr.programNotFound") };
  return { ok: true, program, t };
}

/** Create (no asset_id) or update a marketing asset. Banners take an upload or an image URL. */
export async function saveAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const { program, t } = o;
  const editing = str(formData.get("asset_id")) !== "";
  const existing = editing ? await getOwnedAsset(program.id, idOf(formData.get("asset_id"))) : undefined;
  if (editing && !existing) return { error: t("dash.merr.assetNotFound") };
  const type = existing?.type ?? str(formData.get("type"));
  if (!isAssetType(type)) return { error: t("dash.merr.generic") };
  if (!existing && (await countProgramAssets(program.id)) >= MAX_ASSETS_PER_PROGRAM) return { error: t("dash.merr.assetLimit", { n: MAX_ASSETS_PER_PROGRAM }) };

  const title = clean(str(formData.get("title")), "", 160);
  if (!title) return { error: t("dash.merr.assetTitle") };
  const rawUrl = str(formData.get("url")).trim();
  if (rawUrl && !normalizeAssetUrl(rawUrl)) return { error: t("dash.merr.assetUrl") };
  const content = text(str(formData.get("content")), 10_000);
  if ((type === "text" || type === "email") && !content) return { error: t("dash.merr.assetContent") };

  let image = existing?.image ?? null;
  if (type === "banner") {
    const file = formData.get("image_file");
    if (file instanceof File && file.size > 0) {
      try {
        image = await saveUpload(file, `program-${program.id}-banner`);
      } catch (error) {
        return { error: error instanceof Error ? error.message : t("dash.merr.upload") };
      }
    } else {
      const url = str(formData.get("image_url")).trim();
      if (url && url !== image) {
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return { error: t("dash.merr.logoUrl") };
        image = url;
      }
    }
    if (!image) return { error: t("dash.merr.bannerImage") };
  }

  const input: AssetInput = {
    type,
    title,
    url: rawUrl,
    image: type === "banner" ? image : null,
    content: content || null,
    isActive: existing ? formData.get("active") === "on" : true,
  };
  if (existing) {
    await updateAsset(existing.id, input);
    return { success: t("dash.assets.saved") };
  }
  await createAsset(program.id, input);
  return { success: t("dash.assets.created") };
}

export async function toggleAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const asset = await getOwnedAsset(o.program.id, idOf(formData.get("asset_id")));
  if (!asset) return { error: o.t("dash.merr.assetNotFound") };
  await setAssetActive(asset.id, formData.get("active") === "1");
  return {};
}

export async function moveAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const asset = await getOwnedAsset(o.program.id, idOf(formData.get("asset_id")));
  if (!asset) return { error: o.t("dash.merr.assetNotFound") };
  await moveAsset(o.program.id, asset.id, str(formData.get("direction")) === "up" ? -1 : 1);
  return {};
}

export async function deleteAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const o = await owned(formData);
  if (!o.ok) return { error: o.error };
  const asset = await getOwnedAsset(o.program.id, idOf(formData.get("asset_id")));
  if (!asset) return { error: o.t("dash.merr.assetNotFound") };
  await deleteAsset(asset.id);
  return { success: o.t("dash.assets.deleted") };
}
