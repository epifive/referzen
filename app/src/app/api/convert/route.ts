import { handleConvert, trackPreflight } from "@/lib/tracking";
import { maybeLazyTick } from "@/lib/lazy-tick";

/**
 * Client-side conversion: window.referzen.convert({ amount, currency, orderId, email }).
 * Only when the program allows client-side conversions; recorded with the "client_side" flag.
 *
 *   POST /api/convert   body: { k: programKey, t: referralToken, a: amount (major units), cur?: currency, o: orderId, e?: email }
 *   -> 200 { ok: true }   recorded (or already recorded: idempotent on the order id)
 *   -> 404 {}   unknown token / not attributable (silent)
 *   -> 403 { error }   client-side conversions are off, the program is paused or unavailable
 *   -> 400 / 413 / 429 { error }
 * See src/lib/tracking.ts for the checks (origin, bots, rate limits) and src/tracker/README.md.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return trackPreflight();
}

export async function POST(request: Request) {
  const response = await handleConvert(request);
  maybeLazyTick();
  return response;
}
