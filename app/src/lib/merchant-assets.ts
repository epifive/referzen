import "server-only";
import { getDb, now } from "./db";
import type { Asset } from "./db/schema";
import { str, text } from "@/referral/normalize";
import { ASSET_TYPES, type AssetType } from "@/referral/types";

/**
 * Marketing assets of a program (links, banners, text snippets, email swipes), managed in the
 * merchant dashboard and shown to affiliates in the portal. In `content`, {link} and {code} are
 * replaced with the affiliate's referral link and code (see fillAssetPlaceholders()).
 */

export interface AssetRecord {
  id: number;
  programId: number;
  type: AssetType;
  title: string;
  /** Target page on the merchant site (path or full URL), "" = home page. */
  url: string;
  /** Banner image: upload file name (see uploadUrl()) or http(s) URL. */
  image: string | null;
  content: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function isAssetType(v: unknown): v is AssetType {
  return typeof v === "string" && (ASSET_TYPES as readonly string[]).includes(v);
}

export function toAssetRecord(row: Asset): AssetRecord {
  return {
    id: row.id,
    programId: row.program_id,
    type: isAssetType(row.type) ? row.type : "link",
    title: row.title,
    url: row.url,
    image: row.image,
    content: row.content,
    isActive: row.is_active === 1,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Assets of a program in display order. `activeOnly` for the affiliate portal. */
export async function listProgramAssets(programId: number, options: { activeOnly?: boolean } = {}): Promise<AssetRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("assets")
    .selectAll()
    .where("program_id", "=", programId)
    .$if(Boolean(options.activeOnly), (qb) => qb.where("is_active", "=", 1))
    .orderBy("sort_order")
    .orderBy("id")
    .execute();
  return rows.map(toAssetRecord);
}

export async function getOwnedAsset(programId: number, assetId: number): Promise<AssetRecord | undefined> {
  if (!Number.isInteger(assetId) || assetId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("assets").selectAll().where("id", "=", assetId).where("program_id", "=", programId).executeTakeFirst();
  return row ? toAssetRecord(row) : undefined;
}

export const MAX_ASSETS_PER_PROGRAM = 200;

export interface AssetInput {
  type: AssetType;
  title: string;
  url: string;
  image: string | null;
  content: string | null;
  isActive: boolean;
}

/** Path ("/pricing") or http(s) URL of a target page; "" when invalid. */
export function normalizeAssetUrl(v: unknown): string {
  const s = str(v, "", 1000);
  if (!s) return "";
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^\/[^\s"'<>]*$/.test(s)) return s;
  return "";
}

export function cleanAssetInput(input: AssetInput): AssetInput {
  return {
    type: input.type,
    title: str(input.title, "", 160),
    url: normalizeAssetUrl(input.url),
    image: input.image ? str(input.image, "", 500) : null,
    content: input.content ? text(input.content, 10_000) || null : null,
    isActive: input.isActive,
  };
}

export async function createAsset(programId: number, input: AssetInput): Promise<number> {
  const db = await getDb();
  const ts = now();
  const clean = cleanAssetInput(input);
  const last = await db.selectFrom("assets").select((eb) => eb.fn.max<number>("sort_order").as("m")).where("program_id", "=", programId).executeTakeFirst();
  const result = await db
    .insertInto("assets")
    .values({
      program_id: programId,
      type: clean.type,
      title: clean.title,
      url: clean.url,
      image: clean.image,
      content: clean.content,
      is_active: clean.isActive ? 1 : 0,
      sort_order: Number(last?.m ?? 0) + 1,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  return Number(result.insertId);
}

export async function updateAsset(assetId: number, input: AssetInput): Promise<void> {
  const db = await getDb();
  const clean = cleanAssetInput(input);
  await db
    .updateTable("assets")
    .set({ type: clean.type, title: clean.title, url: clean.url, image: clean.image, content: clean.content, is_active: clean.isActive ? 1 : 0, updated_at: now() })
    .where("id", "=", assetId)
    .execute();
}

export async function setAssetActive(assetId: number, active: boolean): Promise<void> {
  const db = await getDb();
  await db.updateTable("assets").set({ is_active: active ? 1 : 0, updated_at: now() }).where("id", "=", assetId).execute();
}

/** Move an asset one place up or down within its program. */
export async function moveAsset(programId: number, assetId: number, direction: -1 | 1): Promise<void> {
  const list = await listProgramAssets(programId);
  const i = list.findIndex((a) => a.id === assetId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    for (let k = 0; k < list.length; k++) {
      if (list[k].sortOrder !== k + 1) await trx.updateTable("assets").set({ sort_order: k + 1 }).where("id", "=", list[k].id).execute();
    }
  });
}

export async function deleteAsset(assetId: number): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("assets").where("id", "=", assetId).execute();
}

export async function countProgramAssets(programId: number): Promise<number> {
  const db = await getDb();
  const row = await db.selectFrom("assets").select((eb) => eb.fn.countAll<number>().as("n")).where("program_id", "=", programId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Replace {link} and {code} in asset text with an affiliate's values. */
export function fillAssetPlaceholders(content: string, values: { link: string; code: string }): string {
  return content.replace(/\{link\}/g, values.link).replace(/\{code\}/g, values.code);
}
