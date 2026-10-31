import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { apiProgram, readApiJson, toApiConversion } from "@/lib/api-v1";
import { processReferralEvent } from "@/lib/attribution";
import { getDb } from "@/lib/db";
import { normalizeCurrency, str, toMinorUnits } from "@/referral/normalize";

/**
 * POST /api/v1/conversions/refund: reverse the commission of a refunded order.
 *
 *   { "program_id": 1, "order_id": "1001", "amount": 49.9 (optional: refunded amount; below 50% keeps the commission), "reason": "Refunded" }
 *   -> 200 { conversion, reversed: true }
 *   -> 200 { conversion, reversed: false, already_reversed: true }
 *   -> 404 { error }   no conversion with this order id
 *   -> 409 { error }   a partial refund below 50%
 * A commission that was already paid out is reversed too: it is deducted from the affiliate's
 * next payout (deducted_from_next_payout: true).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const program = await apiProgram(body.program_id, guard.user.id, { write: true });
  if (program instanceof Response) return program;
  const orderId = str(body.order_id, "", 190);
  if (!orderId) return apiError(400, "order_id is required.");
  const currency = normalizeCurrency(body.currency, program.currency);
  const result = await processReferralEvent(program, "api", {
    kind: "refund",
    externalId: orderId,
    relatedIds: [orderId],
    amountCents: body.amount === undefined || body.amount === null ? 0 : toMinorUnits(body.amount, currency),
    currency,
    reason: str(body.reason, "", 200) || "Refunded",
  });
  const db = await getDb();
  const codeOf = async (affiliateId: number) => (await db.selectFrom("affiliates").select("code").where("id", "=", affiliateId).executeTakeFirst())?.code ?? "";
  if (result.status === "reversed") {
    return apiJson({ conversion: toApiConversion(result.conversion, await codeOf(result.conversion.affiliateId), program.currency), reversed: true, ...(result.adjusted ? { deducted_from_next_payout: true } : {}) });
  }
  if (result.status === "duplicate") {
    return apiJson({ conversion: toApiConversion(result.conversion, await codeOf(result.conversion.affiliateId), program.currency), reversed: false, already_reversed: true });
  }
  const reason = result.status === "ignored" ? result.reason : "The conversion could not be reversed.";
  return apiError(reason.startsWith("No conversion") ? 404 : 409, reason);
}
