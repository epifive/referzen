import "server-only";
import crypto from "node:crypto";
import { isIP } from "node:net";
import { getDb } from "./db";

/**
 * Daily salts for the anonymous visitor hash of clicks (and the affiliate's own portal
 * visits, for self-referral checks). A new random salt is created for every UTC day, so the
 * same visitor gets an unrelated hash tomorrow and nobody can follow people across days or
 * turn a hash back into an IP address. Salts live in the `settings` table under the key
 * "visitor_salt:YYYY-MM-DD"; salts older than yesterday are deleted when a new day starts.
 */

const PREFIX = "visitor_salt:";

const globalForSalts = globalThis as unknown as { __referzenSalts?: Map<string, Promise<string>> };
const cache = (globalForSalts.__referzenSalts ??= new Map());

/** "YYYY-MM-DD" (UTC) for a date. */
export function saltDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function loadOrCreate(day: string): Promise<string> {
  const db = await getDb();
  const key = `${PREFIX}${day}`;
  const existing = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  if (existing?.value) return existing.value;
  const salt = crypto.randomBytes(32).toString("hex");
  try {
    await db.insertInto("settings").values({ key, value: salt }).execute();
    // A new day started: forget salts older than yesterday so old hashes can't be recomputed.
    const yesterday = saltDay(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000));
    await db
      .deleteFrom("settings")
      .where("key", "like", `${PREFIX}%`)
      .where("key", "<", `${PREFIX}${yesterday}`)
      .execute()
      .catch(() => undefined);
    return salt;
  } catch {
    // Another process created it first (primary key conflict): use theirs.
    const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
    if (row?.value) return row.value;
    throw new Error(`Could not create the visitor salt for ${day}.`);
  }
}

/** The salt for a UTC day (get-or-create, cached in memory). */
export function getDailySalt(day = saltDay()): Promise<string> {
  let salt = cache.get(day);
  if (!salt) {
    salt = loadOrCreate(day);
    salt.catch(() => cache.delete(day));
    cache.set(day, salt);
    const oldest = saltDay(new Date(Date.now() - 2 * 86_400_000));
    for (const key of cache.keys()) if (key < oldest) cache.delete(key);
  }
  return salt;
}

/** Anonymous visitor id: sha256(salt + ip + user agent + program), 32 hex characters. */
export function visitorHash(salt: string, ip: string, userAgent: string, programId: number): string {
  return crypto.createHash("sha256").update(`${salt}|${ip}|${userAgent}|${programId}`).digest("hex").slice(0, 32);
}

function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? mapped[1] : v;
}

/**
 * The visitor's IP for the anonymous hash: the first valid address in X-Forwarded-For (the
 * original client, also behind a first-party proxy on the merchant's site), else X-Real-IP.
 * Use the same function everywhere a visitor hash is computed so the hashes match. Rate
 * limits use clientIp() (the trusted hop) instead.
 */
export function visitorIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const ip = normalizeIp(part);
      if (isIP(ip)) return ip;
    }
  }
  const real = normalizeIp(headers.get("x-real-ip") ?? "");
  return isIP(real) ? real : "unknown";
}

/**
 * Today's visitor hash of a request for a program. The affiliate portal stores it as
 * affiliates.last_visitor_hash at sign-in, so conversions whose click came from the same
 * browser and network on the same day are flagged "same_visitor".
 */
export async function currentVisitorHash(programId: number, ip: string, userAgent: string): Promise<string> {
  return visitorHash(await getDailySalt(), ip, userAgent.slice(0, 500), programId);
}

/** currentVisitorHash() of the incoming request (portal sign-in: `await headers()`). */
export function requestVisitorHash(programId: number, headers: Pick<Headers, "get">): Promise<string> {
  return currentVisitorHash(programId, visitorIp(headers), headers.get("user-agent") ?? "");
}
