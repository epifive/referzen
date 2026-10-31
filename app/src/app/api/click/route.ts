import { handleClick, trackPreflight } from "@/lib/tracking";
import { maybeLazyTick } from "@/lib/lazy-tick";

/**
 * Referral link visit, sent by rz.js when the page URL carries a referral code.
 *
 *   POST /api/click   body (text/plain JSON, max 2 KB): { k: programKey, c: code, u: pageUrl, r: referrer, s?: subId }
 *   -> 200 { t: referralToken, c: code, d: cookieDays }   the visitor was referred
 *   -> 404 {}   unknown code or affiliate not approved (silent)
 *   -> 403 { error, status }   program paused, or the owner account is banned
 *   -> 202 {}   bot / prefetch (dropped)
 *   -> 400 / 403 / 413 / 429 { error }
 * See src/lib/tracking.ts for the checks (origin, bots, rate limits) and src/tracker/README.md.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return trackPreflight();
}

export async function POST(request: Request) {
  const response = await handleClick(request);
  maybeLazyTick();
  return response;
}
