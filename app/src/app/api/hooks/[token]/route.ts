import { handleWebhook } from "@/lib/webhooks/receive";
import { maybeLazyTick } from "@/lib/lazy-tick";

/**
 * Incoming conversion webhooks of a program (Stripe, WooCommerce, Shopify or generic JSON).
 *
 *   POST /api/hooks/<webhook token>[?preset=stripe|woocommerce|shopify|generic]
 *   -> 200 { ok: true, preset, created, duplicates, reversed, leads, ignored, results: [...], reason? }
 *   -> 400 { ok: false, error }   unreadable body / invalid payload / signature mismatch
 *   -> 404 { ok: false, error }   unknown webhook URL
 *   -> 413 / 429
 * Valid events that record nothing (not referred, unpaid, unsupported type) answer 200 with
 * a reason, so the provider does not retry them. See src/lib/webhooks/receive.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await handleWebhook(request, token);
  maybeLazyTick();
  return response;
}

export function GET() {
  return Response.json(
    { ok: false, error: "This is a webhook URL: send POST requests from Stripe, WooCommerce, Shopify or your server." },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
