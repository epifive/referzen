import "server-only";
import crypto from "node:crypto";
import { postJson, ToolInputError } from "@/lib/net/ssrf";
import type { AlertPayload, ChannelConfigByType } from "@/referral/types";
import type { SendContext, SendResult } from "./format";

/** POST JSON through the SSRF-safe helper and turn the outcome into a SendResult. */
export async function deliver(
  url: string,
  body: string,
  ctx: SendContext,
  headers: Record<string, string> = {},
  describeStatus?: (status: number) => string | undefined,
): Promise<SendResult> {
  try {
    const status = await postJson(url, body, { timeoutMs: ctx.timeoutMs, headers, anyPort: true, allowPrivate: ctx.allowPrivate });
    if (status >= 200 && status < 300) return { ok: true };
    return { ok: false, error: describeStatus?.(status) ?? `The endpoint answered HTTP ${status}` };
  } catch (error) {
    if (error instanceof ToolInputError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed" };
  }
}

/** "sha256=<hex HMAC-SHA256(body, secret)>" */
export function signBody(body: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Generic webhook: the AlertPayload as JSON. Headers:
 *   X-Referzen-Event:     the event (new_conversion, new_affiliate, …)
 *   X-Referzen-Delivery:  a unique id per delivery
 *   X-Referzen-Signature: sha256=<hex HMAC-SHA256(raw body, secret)> (when the channel has a secret)
 */
export async function sendWebhook(config: ChannelConfigByType["webhook"], payload: AlertPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.url) return { ok: false, error: "No webhook URL configured" };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "X-Referzen-Event": payload.event,
    "X-Referzen-Delivery": crypto.randomUUID(),
  };
  if (config.secret) headers["X-Referzen-Signature"] = signBody(body, config.secret);
  return deliver(config.url, body, ctx, headers);
}
