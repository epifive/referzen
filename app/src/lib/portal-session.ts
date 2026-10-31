import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getDb, now } from "./db";
import { toAffiliateRecord, type AffiliateRecord } from "./affiliates";
import { getProgramBySlug, type ProgramRecord } from "./programs";

/**
 * Affiliate portal sessions (/a/<slug>), separate from platform users' sessions:
 * - cookie "rz_aff" (httpOnly, SameSite=Lax, Secure on https) scoped to the path /a/<slug>,
 *   so an affiliate of one program never sends their cookie to another program's portal
 * - the database keeps only sha256(cookie value) in affiliate_sessions.id
 * - 30 days; a new session (new cookie value) is created at every sign-in
 * - every lookup re-checks that the affiliate belongs to the program of the URL and is not blocked
 */

export const PORTAL_COOKIE = "rz_aff";
const SESSION_DAYS = 30;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function portalCookiePath(slug: string): string {
  return `/a/${slug}`;
}

async function isHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return (h.get("origin") ?? h.get("referer") ?? "").startsWith("https://");
}

/** Create a portal session and set its cookie. Server Actions / Route Handlers only. */
export async function createAffiliateSession(affiliateId: number, slug: string): Promise<void> {
  const jar = await cookies();
  const db = await getDb();
  // Rotation: a sign-in never reuses the cookie value the browser had before.
  const previous = jar.get(PORTAL_COOKIE)?.value;
  if (previous) await db.deleteFrom("affiliate_sessions").where("id", "=", hashToken(previous)).execute();

  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  await db
    .insertInto("affiliate_sessions")
    .values({
      id: hashToken(token),
      affiliate_id: affiliateId,
      expires_at: expires.toISOString(),
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 255) || null,
      created_at: now(),
    })
    .execute();
  jar.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: portalCookiePath(slug),
    expires,
  });
}

/** Sign out of the portal of `slug` (deletes the session row and the cookie). */
export async function destroyAffiliateSession(slug: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.deleteFrom("affiliate_sessions").where("id", "=", hashToken(token)).execute();
  }
  jar.set(PORTAL_COOKIE, "", { httpOnly: true, sameSite: "lax", path: portalCookiePath(slug), expires: new Date(0) });
}

/**
 * The signed-in affiliate of `program` for this request, or null. Deduplicated per request.
 * Sessions of blocked affiliates, of another program or past their expiry don't count (and
 * are deleted).
 */
export const getPortalAffiliate = cache(async (programId: number): Promise<AffiliateRecord | null> => {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const db = await getDb();
  const id = hashToken(token);
  const session = await db.selectFrom("affiliate_sessions").select(["affiliate_id", "expires_at"]).where("id", "=", id).executeTakeFirst();
  if (!session) return null;
  const row = await db.selectFrom("affiliates").selectAll().where("id", "=", session.affiliate_id).executeTakeFirst();
  if (!row || row.program_id !== programId) return null;
  if (session.expires_at < now() || row.status === "blocked") {
    await db.deleteFrom("affiliate_sessions").where("id", "=", id).execute();
    return null;
  }
  return toAffiliateRecord(row);
});

/** Program of a portal URL, cached per request. */
export const getPortalProgram = cache(async (slug: string): Promise<ProgramRecord | undefined> => getProgramBySlug(slug));

/** Delete expired portal sessions and reset/invitation links (housekeeping job). */
export async function cleanupAffiliateSessions(): Promise<number> {
  const db = await getDb();
  const ts = now();
  const a = await db.deleteFrom("affiliate_sessions").where("expires_at", "<", ts).executeTakeFirst();
  const b = await db.deleteFrom("affiliate_password_resets").where("expires_at", "<", ts).executeTakeFirst();
  return Number(a.numDeletedRows ?? 0) + Number(b.numDeletedRows ?? 0);
}
