import "server-only";
import crypto from "node:crypto";
import { safeEqual } from "@/lib/tokens";
import type { HeaderReader, WebhookPreset } from "./presets";

/**
 * Signature checks for incoming webhooks. The secret token in the URL already identifies the
 * program; when the merchant also stores signing secrets (programs.webhook_secret, one or more,
 * see parseWebhookSecrets()) every request must be signed with one of them:
 * - Stripe: "Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${body}`>" (5 min tolerance)
 * - WooCommerce: "X-WC-Webhook-Signature: <base64 HMAC-SHA256 of body>"
 * - Shopify: "X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256 of body>"
 * - Generic: "X-Referzen-Signature: sha256=<hex HMAC-SHA256 of body>"
 * A missing signature is refused with 401, a wrong one with 400. The only unsigned request
 * accepted is WooCommerce's "ping" (webhook_id=<n>) sent when the webhook is saved: it records nothing.
 */

export const STRIPE_TOLERANCE_SEC = 300;

export interface SignatureError {
  status: 400 | 401;
  error: string;
}

const hmac = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload, "utf8");

/** The Stripe-Signature header value for `payload` (tests and the dashboard's signed test events). */
export function stripeSignatureHeader(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`).digest("hex")}`;
}

/** Base64 HMAC-SHA256 of the body (WooCommerce / Shopify style). */
export function base64Signature(payload: string, secret: string): string {
  return hmac(secret, payload).digest("base64");
}

/** Hex HMAC-SHA256 of the body (X-Referzen-Signature, without the "sha256=" prefix). */
export function hexSignature(payload: string, secret: string): string {
  return hmac(secret, payload).digest("hex");
}

export function verifyStripeSignature(payload: string, header: string | null, secrets: string | string[], nowSec = Math.floor(Date.now() / 1000)): SignatureError | null {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  if (!header) return { status: 401, error: "Missing Stripe-Signature header. Signed events are required because a signing secret is saved for this program." };
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (k === "t") timestamp = Number(v);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return { status: 400, error: "Malformed Stripe-Signature header." };
  if (Math.abs(nowSec - timestamp) > STRIPE_TOLERANCE_SEC) return { status: 400, error: "Stripe signature timestamp is too old (more than 5 minutes)." };
  const ok = list.some((secret) => {
    const expected = hmac(secret, `${timestamp}.${payload}`).digest("hex");
    return signatures.some((s) => safeEqual(s, expected));
  });
  return ok ? null : { status: 400, error: "Stripe signature does not match. Check the signing secret (whsec_…) in the program's integration settings." };
}

/** WooCommerce's unsigned ping when a webhook is saved (form-encoded webhook_id=<n>). */
function isWooPing(payload: string): boolean {
  return /^webhook_id=\d{1,20}$/.test(payload.trim());
}

/**
 * Check the request signature for `preset` against the program's signing secrets. Returns null
 * when valid (or when no secret is saved), else the status and message of the error response.
 */
export function verifyWebhookSignature(preset: WebhookPreset, payload: string, headers: HeaderReader, secrets: string[]): SignatureError | null {
  if (!secrets.length) return null;
  const matches = (sig: string, sign: (secret: string) => string) => secrets.some((secret) => safeEqual(sig, sign(secret)));
  switch (preset) {
    case "stripe":
      return verifyStripeSignature(payload, headers.get("stripe-signature"), secrets);
    case "woocommerce": {
      const sig = headers.get("x-wc-webhook-signature")?.trim();
      if (!sig) return isWooPing(payload) ? null : { status: 401, error: "Missing X-WC-Webhook-Signature header. Set the webhook secret in WooCommerce to the program's signing secret." };
      return matches(sig, (s) => base64Signature(payload, s)) ? null : { status: 400, error: "WooCommerce signature does not match. Use the same secret in WooCommerce and in the program's integration settings." };
    }
    case "shopify": {
      const sig = headers.get("x-shopify-hmac-sha256")?.trim();
      if (!sig) return { status: 401, error: "Missing X-Shopify-Hmac-Sha256 header. Signed Shopify webhooks are required because a signing secret is saved for this program." };
      return matches(sig, (s) => base64Signature(payload, s)) ? null : { status: 400, error: "Shopify signature does not match. Use the webhook signing secret shown in Shopify → Settings → Notifications." };
    }
    default: {
      const sig = headers.get("x-referzen-signature")?.trim().replace(/^sha256=/i, "");
      if (!sig) return { status: 401, error: "Missing X-Referzen-Signature header (sha256=<hex HMAC-SHA256 of the body>): a signing secret is saved for this program." };
      return matches(sig.toLowerCase(), (s) => hexSignature(payload, s)) ? null : { status: 400, error: "X-Referzen-Signature does not match the signing secret." };
    }
  }
}
