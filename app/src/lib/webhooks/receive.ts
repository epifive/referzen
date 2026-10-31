import "server-only";
import { describeResult, processReferralEvent } from "@/lib/attribution";
import { getProgramAvailability, getProgramByWebhookToken, parseWebhookSecrets, unavailableMessage } from "@/lib/programs";
import { BodyTooLargeError, parseJsonText, readBodyText } from "@/lib/public-api";
import { rateLimit } from "@/lib/rate-limit";
import { detectPreset, isWebhookPreset, mapWebhook, type WebhookPreset } from "./presets";
import { verifyWebhookSignature } from "./verify";
import type { ConversionSource } from "@/referral/types";

/**
 * POST /api/hooks/<token>: conversion webhooks from Stripe, WooCommerce, Shopify or any server
 * (generic JSON). The token in the URL identifies the program; when the merchant stored signing
 * secrets, a valid provider signature is required. Each payload becomes referral events
 * (src/lib/webhooks/presets.ts) that are attributed and recorded (src/lib/attribution.ts).
 * Paused programs and programs of banned accounts answer 403 (the provider retries later).
 */

export const MAX_HOOK_BYTES = 512 * 1024;
const HOOKS_PER_MIN = Math.max(1, Number(process.env.WEBHOOK_RATE_LIMIT_PER_MIN) || 300);

const SOURCES: Record<WebhookPreset, ConversionSource> = { stripe: "stripe", woocommerce: "woocommerce", shopify: "shopify", generic: "generic" };

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** WooCommerce's "ping" when the webhook is saved is form-encoded (webhook_id=12). */
function parseBody(text: string): unknown {
  const parsed = parseJsonText(text);
  if (parsed !== undefined) return parsed;
  const form = /^webhook_id=(\d{1,20})$/.exec(text.trim());
  return form ? { webhook_id: form[1] } : undefined;
}

export async function handleWebhook(request: Request, token: string): Promise<Response> {
  const found = await getProgramByWebhookToken(token);
  if (!found) return json(404, { ok: false, error: "Unknown webhook URL. Copy it again from the program's Integrations page." });
  const { program, webhookSecret } = found;
  if (!rateLimit(`hook:${program.id}`, HOOKS_PER_MIN, 60_000)) return json(429, { ok: false, error: "Too many requests." }, { "Retry-After": "60" });

  let text: string;
  try {
    text = await readBodyText(request, MAX_HOOK_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { ok: false, error: "Payload too large (max 512 KB)." });
    return json(400, { ok: false, error: "Could not read the request body." });
  }
  const body = parseBody(text);
  if (body === undefined) return json(400, { ok: false, error: "The request body is not valid JSON." });

  const requested = new URL(request.url).searchParams.get("preset");
  const preset: WebhookPreset = isWebhookPreset(requested) ? requested : detectPreset(body, request.headers);

  const signatureError = verifyWebhookSignature(preset, text, request.headers, parseWebhookSecrets(webhookSecret));
  if (signatureError) return json(signatureError.status, { ok: false, preset, error: signatureError.error });

  const availability = await getProgramAvailability(program);
  if (availability !== "active") return json(403, { ok: false, preset, error: unavailableMessage(availability), program_status: availability });

  const mapped = mapWebhook(preset, body, request.headers, { refParams: program.settings.refParams });
  if (mapped.status === "error") return json(400, { ok: false, preset, error: mapped.error });
  if (mapped.status === "ignored") return json(200, { ok: true, preset, ignored: 1, reason: mapped.reason });

  const counts = { created: 0, duplicates: 0, reversed: 0, leads: 0, ignored: 0, rejected: 0 };
  const results: Array<Record<string, unknown>> = [];
  for (const event of mapped.events) {
    const result = await processReferralEvent(program, SOURCES[preset], event);
    switch (result.status) {
      case "created":
        counts.created += 1;
        break;
      case "duplicate":
        counts.duplicates += 1;
        break;
      case "reversed":
        counts.reversed += 1;
        break;
      case "lead":
        counts.leads += 1;
        break;
      case "ignored":
        counts.ignored += 1;
        break;
      case "rejected":
        counts.rejected += 1;
        break;
    }
    results.push({ kind: event.kind, id: event.externalId || undefined, ...describeResult(result, program.currency) });
  }
  const reason = results.length === 1 && typeof results[0].reason === "string" ? results[0].reason : undefined;
  return json(200, { ok: true, preset, ...counts, ...(reason ? { reason } : {}), results });
}
