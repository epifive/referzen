import { handleReferral, trackPreflight } from "@/lib/tracking";
import { maybeLazyTick } from "@/lib/lazy-tick";

/**
 * A referred visitor signed up (a lead): window.referzen.signup({ email, customerId }).
 *
 *   POST /api/referral   body: { k: programKey, t: referralToken, e?: email, i?: customerId }
 *   -> 200 { ok: true }   lead created / updated
 *   -> 404 {}   unknown or expired referral token (silent)
 *   -> 403 { error, status }   program paused or unavailable
 *   -> 400 / 403 / 413 / 429 { error }
 * See src/lib/tracking.ts for the checks (origin, bots, rate limits) and src/tracker/README.md.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return trackPreflight();
}

export async function POST(request: Request) {
  const response = await handleReferral(request);
  maybeLazyTick();
  return response;
}
