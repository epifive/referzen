import "server-only";
import type { Transaction } from "kysely";
import { getDb, now } from "./db";
import type { Database, Program } from "./db/schema";
import { getSettings } from "./settings";
import { randomToken } from "./tokens";
import { isReservedSlug, normalizeCurrency, normalizeProgramSettings, normalizeSlug, parseJson } from "@/referral/normalize";
import type { ProgramSettings, ProgramStatus } from "@/referral/types";

/** A stored program with its settings parsed and validated. Never contains the webhook secret. */
export interface ProgramRecord {
  id: number;
  userId: number;
  name: string;
  /** Portal address: /a/<slug>. */
  slug: string;
  /** Merchant website (bare hostname). */
  domain: string;
  currency: string;
  status: ProgramStatus;
  settings: ProgramSettings;
  /** data-program attribute of the tracking snippet. */
  publicKey: string;
  /** Secret part of /api/hooks/<token>. */
  webhookToken: string;
  /** True when a provider signing secret (Stripe whsec_…) is stored. */
  hasWebhookSecret: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toProgramRecord(row: Program): ProgramRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    currency: row.currency,
    status: row.status === "paused" ? "paused" : "active",
    settings: normalizeProgramSettings(parseJson(row.settings)),
    publicKey: row.public_key,
    webhookToken: row.webhook_token,
    hasWebhookSecret: Boolean(row.webhook_secret),
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Public affiliate portal path of a program. */
export function portalPath(slug: string, page = ""): string {
  return `/a/${slug}${page ? `/${page.replace(/^\/+/, "")}` : ""}`;
}

/** Path of the incoming webhook URL (prefix with absoluteUrl()). */
export function webhookPath(token: string): string {
  return `/api/hooks/${token}`;
}

export const newPublicKey = () => randomToken(12);
export const newWebhookToken = () => randomToken(32);

export async function getUserPrograms(userId: number): Promise<ProgramRecord[]> {
  const db = await getDb();
  return (await db.selectFrom("programs").selectAll().where("user_id", "=", userId).orderBy("id").execute()).map(toProgramRecord);
}

export async function countUserPrograms(userId: number): Promise<number> {
  const db = await getDb();
  const row = await db.selectFrom("programs").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", userId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** A program owned by `userId`, or undefined. Always use this for ids from user input (prevents IDOR). */
export async function getOwnedProgram(programId: number, userId: number): Promise<ProgramRecord | undefined> {
  if (!Number.isInteger(programId) || programId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("programs").selectAll().where("id", "=", programId).where("user_id", "=", userId).executeTakeFirst();
  return row ? toProgramRecord(row) : undefined;
}

export async function getProgram(programId: number): Promise<ProgramRecord | undefined> {
  if (!Number.isInteger(programId) || programId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("programs").selectAll().where("id", "=", programId).executeTakeFirst();
  return row ? toProgramRecord(row) : undefined;
}

/** Program of a portal URL (/a/<slug>). */
export async function getProgramBySlug(slug: string): Promise<ProgramRecord | undefined> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("programs").selectAll().where("slug", "=", slug).executeTakeFirst();
  return row ? toProgramRecord(row) : undefined;
}

/** Program of a tracking snippet (data-program attribute). */
export async function getProgramByKey(publicKey: string): Promise<ProgramRecord | undefined> {
  if (!/^[A-Za-z0-9]{8,32}$/.test(publicKey)) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("programs").selectAll().where("public_key", "=", publicKey).executeTakeFirst();
  return row ? toProgramRecord(row) : undefined;
}

/** Program of an incoming webhook URL (/api/hooks/<token>), with its signing secret. */
export async function getProgramByWebhookToken(token: string): Promise<{ program: ProgramRecord; webhookSecret: string | null } | undefined> {
  if (!/^[A-Za-z0-9]{16,48}$/.test(token)) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("programs").selectAll().where("webhook_token", "=", token).executeTakeFirst();
  return row ? { program: toProgramRecord(row), webhookSecret: row.webhook_secret } : undefined;
}

export async function isSlugTaken(slug: string, exceptProgramId?: number): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom("programs")
    .select("id")
    .where("slug", "=", slug)
    .$if(exceptProgramId !== undefined, (qb) => qb.where("id", "!=", exceptProgramId!))
    .executeTakeFirst();
  return Boolean(row);
}

/** A free portal slug based on `base` ("acme", "acme-2", …). */
export async function uniqueSlug(base: string, exceptProgramId?: number): Promise<string> {
  let root = normalizeSlug(base) || `program-${randomToken(4).toLowerCase()}`;
  if (isReservedSlug(root)) root = `${root}-program`;
  root = root.slice(0, 34).replace(/-+$/, "");
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (!(await isSlugTaken(candidate, exceptProgramId))) return candidate;
  }
  return `${root}-${randomToken(5).toLowerCase()}`;
}

export interface ProgramInput {
  name: string;
  /** Bare hostname, already normalised (normalizeDomain()). */
  domain: string;
  currency?: string;
  /** Requested portal slug (made unique); default from the name. */
  slug?: string;
  /** Partial settings; missing values use the defaults (hold days from Admin → Settings → Referrals). */
  settings?: Partial<ProgramSettings>;
}

export async function createProgram(userId: number, input: ProgramInput): Promise<ProgramRecord> {
  const db = await getDb();
  const ts = now();
  const platform = await getSettings();
  const settings = normalizeProgramSettings({
    holdDays: Math.max(0, Math.floor(platform.default_hold_days || 0)),
    ...input.settings,
  });
  const name = input.name.trim().slice(0, 120) || input.domain;
  const slug = await uniqueSlug(input.slug || name);
  const result = await db
    .insertInto("programs")
    .values({
      user_id: userId,
      name,
      slug,
      domain: input.domain,
      currency: normalizeCurrency(input.currency, platform.currency || "USD"),
      settings: JSON.stringify(settings),
      status: "active",
      public_key: newPublicKey(),
      webhook_token: newWebhookToken(),
      webhook_secret: null,
      verified_at: null,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  return (await getProgram(Number(result.insertId)))!;
}

export interface ProgramUpdate {
  name?: string;
  /** Must be normalised and free (check isSlugTaken()). */
  slug?: string;
  domain?: string;
  currency?: string;
  status?: ProgramStatus;
  /** Full or partial settings, merged over the current ones and normalised. */
  settings?: Partial<ProgramSettings>;
}

export async function updateProgram(program: Pick<ProgramRecord, "id" | "settings">, input: ProgramUpdate): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("programs")
    .set({
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.currency !== undefined ? { currency: normalizeCurrency(input.currency) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.settings !== undefined ? { settings: JSON.stringify(normalizeProgramSettings({ ...program.settings, ...input.settings })) } : {}),
      updated_at: now(),
    })
    .where("id", "=", program.id)
    .execute();
}

/** New webhook URL token (the old URL stops working). Returns the token. */
export async function regenerateWebhookToken(programId: number): Promise<string> {
  const db = await getDb();
  const token = newWebhookToken();
  await db.updateTable("programs").set({ webhook_token: token, updated_at: now() }).where("id", "=", programId).execute();
  return token;
}

/** New snippet key (old snippets stop working). Returns the key. */
export async function regeneratePublicKey(programId: number): Promise<string> {
  const db = await getDb();
  const key = newPublicKey();
  await db.updateTable("programs").set({ public_key: key, updated_at: now() }).where("id", "=", programId).execute();
  return key;
}

/** Most signing secrets stored per program, and the column size they share. */
export const MAX_WEBHOOK_SECRETS = 5;
export const WEBHOOK_SECRET_FIELD_MAX = 255;

/**
 * The signing secrets of a program's webhook_secret field: one secret, several separated by
 * newlines or commas (one per Stripe endpoint, or the old and new one while rotating), or a
 * JSON list of strings. Verification accepts a signature made with any of them.
 */
export function parseWebhookSecrets(value: string | null | undefined): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  let list: unknown[] | null = null;
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = null;
    }
  }
  const items = list ? list.filter((v): v is string => typeof v === "string") : raw.split(/[\r\n,]+/);
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_WEBHOOK_SECRETS);
}

/** Store (or clear with null/"") the provider signing secret(s) used to verify webhook signatures. */
export async function setWebhookSecret(programId: number, secret: string | null): Promise<void> {
  const db = await getDb();
  const value = secret?.trim().slice(0, WEBHOOK_SECRET_FIELD_MAX) || null;
  await db.updateTable("programs").set({ webhook_secret: value, updated_at: now() }).where("id", "=", programId).execute();
}

export type ProgramAvailability = "active" | "paused" | "unavailable";

/**
 * Whether a program accepts clicks, referrals, conversions and sign-ups: "paused" by the
 * merchant (or an administrator), "unavailable" when the owner's account is banned.
 */
export async function getProgramAvailability(program: Pick<ProgramRecord, "userId" | "status">): Promise<ProgramAvailability> {
  const db = await getDb();
  const owner = await db.selectFrom("users").select("status").where("id", "=", program.userId).executeTakeFirst();
  if (!owner || owner.status !== "active") return "unavailable";
  return program.status === "paused" ? "paused" : "active";
}

/** Message for refused requests of a program that is not active (API, webhooks and tracking answers). */
export function unavailableMessage(availability: Exclude<ProgramAvailability, "active">): string {
  return availability === "paused"
    ? "This program is paused: clicks, referrals and conversions are not recorded."
    : "This program is unavailable: clicks, referrals and conversions are not recorded.";
}

/** Remember the first click (installation verified). */
export async function markProgramVerified(programId: number): Promise<void> {
  const db = await getDb();
  await db.updateTable("programs").set({ verified_at: now() }).where("id", "=", programId).where("verified_at", "is", null).execute();
}

/** Deletes a program and everything that belongs to it, inside the caller's transaction. */
export async function deleteProgramRows(trx: Transaction<Database>, programId: number): Promise<void> {
  const affiliateIds = (await trx.selectFrom("affiliates").select("id").where("program_id", "=", programId).execute()).map((a) => a.id);
  if (affiliateIds.length) {
    for (let i = 0; i < affiliateIds.length; i += 500) {
      const ids = affiliateIds.slice(i, i + 500);
      await trx.deleteFrom("affiliate_sessions").where("affiliate_id", "in", ids).execute();
      await trx.deleteFrom("affiliate_password_resets").where("affiliate_id", "in", ids).execute();
    }
  }
  for (const table of ["clicks", "click_daily", "referrals", "conversions", "adjustments", "payouts", "payout_batches", "assets", "affiliates"] as const) {
    await trx.deleteFrom(table).where("program_id", "=", programId).execute();
  }
  await trx.updateTable("alert_log").set({ program_id: null }).where("program_id", "=", programId).execute();
  await trx.deleteFrom("programs").where("id", "=", programId).execute();
}

/** Delete a program and everything that belongs to it. */
export async function deleteProgram(programId: number): Promise<void> {
  const db = await getDb();
  await db.transaction().execute((trx) => deleteProgramRows(trx, programId));
}

/** Delete every program of a user (account deletion). */
export async function deleteUserProgramRows(trx: Transaction<Database>, userId: number): Promise<void> {
  const ids = (await trx.selectFrom("programs").select("id").where("user_id", "=", userId).execute()).map((p) => p.id);
  for (const id of ids) await deleteProgramRows(trx, id);
}
