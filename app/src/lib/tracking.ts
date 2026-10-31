import "server-only";
import { isbot } from "isbot";
import { UAParser } from "ua-parser-js";
import { getAffiliate, getAffiliateByCode } from "./affiliates";
import { findClickByToken, processReferralEvent, runAfter } from "./attribution";
import { getDb, now } from "./db";
import { getProgramAvailability, getProgramByKey, markProgramVerified, unavailableMessage, type ProgramRecord } from "./programs";
import { BodyTooLargeError, isRecord, normalizePath, parseJsonText, readBodyText } from "./public-api";
import { clientIp, rateLimit } from "./rate-limit";
import { getDailySalt, visitorHash, visitorIp } from "./salts";
import { randomToken } from "./tokens";
import { incrementUsage } from "./usage";
import { hostMatches, normalizeCode, normalizeCurrency, normalizeEmail, normalizeSubId, str, toMinorUnits } from "@/referral/normalize";
import type { ClickResponse } from "@/referral/types";

/**
 * Public tracking endpoints used by rz.js (src/tracker): POST /api/click, /api/referral and
 * /api/convert. Bodies are small JSON objects (sent as text/plain to avoid CORS preflights,
 * JSON is accepted too), at most 2 KB.
 *
 * - The page (Origin / Referer header and the page URL) must be on the program's domain, a
 *   subdomain of it or one of its extra domains (localhost only when the program allows it):
 *   otherwise 403.
 * - Bots, prefetches and previews are dropped silently (202 {}).
 * - Unknown referral codes and affiliates that are not approved get a silent 404 {} so codes
 *   can't be probed.
 * - Paused programs and programs of banned accounts answer 403 { error, status } (nothing is
 *   recorded; rz.js keeps the page working).
 * - Rate limits per visitor IP and program (429).
 * No IP address is stored: clicks keep a daily-salted visitor hash (src/lib/salts.ts).
 */

export const MAX_TRACK_BYTES = 2048;
/** A repeated click of the same visitor on the same affiliate's link within this time is a duplicate. */
export const DUPLICATE_WINDOW_MS = 30 * 60_000;

const CLICKS_PER_MIN = Math.max(1, Number(process.env.CLICK_RATE_LIMIT_PER_MIN) || 30);
/** Per connecting address (a first-party proxy sends for all its visitors). */
const PROXY_CLICKS_PER_MIN = Math.max(1, Number(process.env.CLICK_PROXY_RATE_LIMIT_PER_MIN) || 600);

export const TRACK_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

function reply(status: number, body: unknown = {}): Response {
  return Response.json(body, { status, headers: TRACK_CORS_HEADERS });
}

const silent = () => reply(404, {});
const dropped = () => reply(202, {});

export function trackPreflight(): Response {
  return new Response(null, { status: 204, headers: TRACK_CORS_HEADERS });
}

// ── Hosts ──

function cleanHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** The program's own hostnames: its domain, subdomains and extra domains (localhost when allowed). */
export function hostAllowed(host: string, program: Pick<ProgramRecord, "domain" | "settings">): boolean {
  const h = cleanHost(host);
  if (!h) return false;
  if (isLocalHost(h)) return program.settings.allowLocalhost || program.domain === "localhost";
  return hostMatches(h, program.domain) || program.settings.extraDomains.some((d) => hostMatches(h, d));
}

function hostOf(url: string | null): string | null {
  if (!url || url === "null") return null;
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The sending page (Origin, else Referer) must be one of the program's hosts; requests without either pass. */
function originAllowed(request: Request, program: ProgramRecord): boolean {
  const host = hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));
  return host === null || hostAllowed(host, program);
}

// ── Visitors ──

function isBotRequest(h: Headers, ua: string): boolean {
  if (!ua || ua.length < 10) return true;
  const purpose = `${h.get("purpose") ?? ""} ${h.get("sec-purpose") ?? ""} ${h.get("x-purpose") ?? ""} ${h.get("x-moz") ?? ""}`.toLowerCase();
  if (/prefetch|preview/.test(purpose)) return true;
  return isbot(ua);
}

/** desktop | mobile | tablet */
export function deviceType(ua: string): string {
  try {
    const type = new UAParser(ua).getDevice().type;
    if (type === "mobile" || type === "wearable") return "mobile";
    if (type === "tablet") return "tablet";
  } catch {
    // unknown agent
  }
  return "desktop";
}

/** ISO country from the hosting platform's headers (Vercel, Cloudflare, custom proxies), else "". */
export function requestCountry(h: Headers): string {
  const raw = (h.get("x-vercel-ip-country") || h.get("cf-ipcountry") || h.get("x-country-code") || h.get("cloudfront-viewer-country") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : "";
}

// ── Body ──

type Body = Record<string, unknown>;

async function readTrackBody(request: Request): Promise<Body | Response> {
  let text: string;
  try {
    text = await readBodyText(request, MAX_TRACK_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return reply(413, { error: "Payload too large." });
    return reply(400, { error: "Could not read the request body." });
  }
  const body = parseJsonText(text);
  if (!isRecord(body)) return reply(400, { error: "Invalid payload: send a JSON object." });
  return body;
}

interface Context {
  body: Body;
  program: ProgramRecord;
  ip: string;
  ua: string;
}

/** Shared checks: body, program key, page origin, bots and rate limits. */
async function prepare(request: Request, kind: "click" | "referral" | "convert", perMinute: number): Promise<Context | Response> {
  const body = await readTrackBody(request);
  if (body instanceof Response) return body;
  const key = typeof body.k === "string" ? body.k : "";
  if (!/^[A-Za-z0-9]{8,32}$/.test(key)) return reply(400, { error: "Missing or invalid program key (k)." });
  const program = await getProgramByKey(key);
  if (!program) return reply(404, { error: "Unknown program key." });
  if (!originAllowed(request, program)) return reply(403, { error: `This page is not on the program's website (${program.domain}).` });
  const h = request.headers;
  const ua = (h.get("user-agent") ?? "").slice(0, 500);
  if (isBotRequest(h, ua)) return dropped();
  const ip = visitorIp(h);
  const hop = await clientIp();
  if (!rateLimit(`${kind}:${program.id}:${ip}`, perMinute, 60_000) || !rateLimit(`${kind}-hop:${program.id}:${hop}`, PROXY_CLICKS_PER_MIN, 60_000)) {
    return reply(429, { error: "Too many requests." });
  }
  const availability = await getProgramAvailability(program);
  if (availability !== "active") return reply(403, { error: unavailableMessage(availability), status: availability });
  return { body, program, ip, ua };
}

// ── POST /api/click ──

export async function handleClick(request: Request): Promise<Response> {
  const ctx = await prepare(request, "click", CLICKS_PER_MIN);
  if (ctx instanceof Response) return ctx;
  const { body, program, ip, ua } = ctx;

  if (typeof body.u !== "string" || body.u.length > 2000) return reply(400, { error: "Missing or invalid page URL (u)." });
  let url: URL;
  try {
    url = new URL(body.u);
  } catch {
    return reply(400, { error: "Missing or invalid page URL (u)." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return reply(400, { error: "Missing or invalid page URL (u)." });
  if (!hostAllowed(url.hostname, program)) return reply(403, { error: `This page is not on the program's website (${program.domain}).` });

  const code = normalizeCode(body.c);
  if (!code) return silent();
  const affiliate = await getAffiliateByCode(program.id, code);
  if (!affiliate || affiliate.status !== "approved") return silent();

  const ts = now();
  const hash = visitorHash(await getDailySalt(), ip, ua, program.id);
  const db = await getDb();
  const earlier = await db
    .selectFrom("clicks")
    .select(["token"])
    .where("program_id", "=", program.id)
    .where("visitor_hash", "=", hash)
    .where("affiliate_id", "=", affiliate.id)
    .where("ts", ">=", new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();

  let referrerHost = "";
  if (typeof body.r === "string" && body.r) {
    try {
      referrerHost = new URL(body.r.slice(0, 2000)).hostname.toLowerCase().slice(0, 255);
    } catch {
      referrerHost = "";
    }
  }
  const token = earlier?.token ?? randomToken(24);
  await db
    .insertInto("clicks")
    .values({
      program_id: program.id,
      affiliate_id: affiliate.id,
      ts,
      token,
      landing_path: normalizePath(url.pathname),
      referrer_host: referrerHost,
      visitor_hash: hash,
      country: requestCountry(request.headers),
      device: deviceType(ua),
      sub_id: normalizeSubId(body.s) || normalizeSubId(url.searchParams.get("sub") ?? url.searchParams.get("sub_id") ?? ""),
      is_duplicate: earlier ? 1 : 0,
    })
    .execute();

  runAfter(async () => {
    await incrementUsage(program.userId, { clicks: 1 });
    if (!program.verifiedAt) await markProgramVerified(program.id);
  });

  const response: ClickResponse = { t: token, c: affiliate.code, d: program.settings.cookieDays };
  return reply(200, response);
}

// ── POST /api/referral ──

export async function handleReferral(request: Request): Promise<Response> {
  const ctx = await prepare(request, "referral", 20);
  if (ctx instanceof Response) return ctx;
  const { body, program } = ctx;
  const token = str(body.t, "", 64);
  const email = normalizeEmail(body.e);
  const customer = str(body.i, "", 190);
  if (!token) return reply(400, { error: "Missing referral token (t)." });
  if (!email && !customer) return reply(400, { error: "Send the customer's email (e) or customer id (i)." });
  const click = await findClickByToken(program.id, token);
  if (!click) return silent();
  const result = await processReferralEvent(program, "js", {
    kind: "lead",
    externalId: "",
    amountCents: 0,
    currency: "",
    referralToken: token,
    email: email || undefined,
    customerRef: customer || undefined,
  });
  if (result.status !== "lead") return silent();
  return reply(200, { ok: true });
}

// ── POST /api/convert (client-side conversions, lower trust) ──

export async function handleConvert(request: Request): Promise<Response> {
  const ctx = await prepare(request, "convert", 10);
  if (ctx instanceof Response) return ctx;
  const { body, program } = ctx;
  if (!program.settings.allowClientConversions) {
    return reply(403, { error: "Client-side conversions are turned off for this program. Send conversions from your server (webhook or REST API)." });
  }
  const token = str(body.t, "", 64);
  const orderId = str(body.o, "", 190);
  const currency = normalizeCurrency(body.cur, program.currency);
  const amountCents = toMinorUnits(body.a, currency);
  if (!token || !orderId || !amountCents) return reply(400, { error: "Send the referral token (t), the order id (o) and a positive amount (a)." });
  const click = await findClickByToken(program.id, token);
  if (!click) return silent();
  const affiliate = await getAffiliate(click.affiliate_id);
  if (!affiliate || affiliate.status !== "approved") return silent();
  const result = await processReferralEvent(
    program,
    "js",
    { kind: "payment", externalId: orderId, amountCents, currency, referralToken: token, email: normalizeEmail(body.e) || undefined },
    { flags: ["client_side"] },
  );
  if (result.status === "created" || result.status === "duplicate") return reply(200, { ok: true });
  return silent();
}
