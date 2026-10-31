import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { apiProgram, pageParams, readApiJson, toApiConversion } from "@/lib/api-v1";
import { processReferralEvent } from "@/lib/attribution";
import { toConversionRecord } from "@/lib/conversions";
import { getDb } from "@/lib/db";
import { isConversionStatus, normalizeCurrency, normalizeEmail, str, toMinorUnits } from "@/referral/normalize";

/**
 * REST API: conversions of a program.
 *
 * GET /api/v1/conversions?program_id=1[&status=pending|approved|paid|reversed][&from=ISO][&to=ISO][&affiliate_id=][&limit=50][&offset=0]
 *   -> 200 { data: ApiConversion[], limit, offset }   newest first
 *
 * POST /api/v1/conversions   (a payment; repeating the same order_id is a no-op)
 *   { "program_id": 1, "order_id": "1001", "amount": 49.9, "currency": "USD",
 *     "referral": "<rz_ref token>", "affiliate_code": "jane", "customer_id": "cus_1", "email": "…",
 *     "subscription_id": "sub_1", "coupon": "JANE10", "occurred_at": "2026-10-18T10:00:00Z" }
 *   -> 201 { conversion, duplicate: false, attributed_by }
 *   -> 200 { conversion, duplicate: true }            already recorded
 *   -> 200 { conversion: null, ignored: true, reason } not referred / outside the recurring period
 *   -> 403 { error }   monthly conversion limit of the plan reached, or the program is paused
 */

export const dynamic = "force-dynamic";

function isoParam(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function GET(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const program = await apiProgram(url.searchParams.get("program_id"), guard.user.id);
  if (program instanceof Response) return program;
  const status = url.searchParams.get("status");
  if (status && !isConversionStatus(status)) return apiError(400, "status must be pending, approved, paid or reversed.");
  const from = isoParam(url.searchParams.get("from"));
  const to = isoParam(url.searchParams.get("to"));
  if ((url.searchParams.get("from") && !from) || (url.searchParams.get("to") && !to)) return apiError(400, "from / to must be ISO dates (2026-10-01 or 2026-10-01T00:00:00Z).");
  const affiliateId = Number(url.searchParams.get("affiliate_id")) || 0;
  const { limit, offset } = pageParams(url);
  const db = await getDb();
  const rows = await db
    .selectFrom("conversions")
    .innerJoin("affiliates", "affiliates.id", "conversions.affiliate_id")
    .selectAll("conversions")
    .select("affiliates.code as affiliate_code")
    .where("conversions.program_id", "=", program.id)
    .$if(Boolean(status), (qb) => qb.where("conversions.status", "=", status as "pending"))
    .$if(Boolean(from), (qb) => qb.where("conversions.occurred_at", ">=", from!))
    .$if(Boolean(to), (qb) => qb.where("conversions.occurred_at", "<=", to!))
    .$if(affiliateId > 0, (qb) => qb.where("conversions.affiliate_id", "=", affiliateId))
    .orderBy("conversions.occurred_at", "desc")
    .orderBy("conversions.id", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
  return apiJson({ data: rows.map(({ affiliate_code, ...row }) => toApiConversion(toConversionRecord(row), affiliate_code, program.currency)), limit, offset });
}

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const program = await apiProgram(body.program_id, guard.user.id, { write: true });
  if (program instanceof Response) return program;

  const orderId = str(body.order_id, "", 190);
  if (!orderId) return apiError(400, "order_id is required (your order / invoice id; unique per program).");
  const currency = normalizeCurrency(body.currency, program.currency);
  const amountCents = toMinorUnits(body.amount, currency);
  if (!amountCents) return apiError(400, "amount must be a positive number in major units (49.90).");
  const occurredAt = typeof body.occurred_at === "string" && body.occurred_at ? isoParam(body.occurred_at) : null;
  if (body.occurred_at && !occurredAt) return apiError(400, "occurred_at must be an ISO date.");

  const result = await processReferralEvent(program, "api", {
    kind: "payment",
    externalId: orderId,
    amountCents,
    currency,
    referralToken: str(body.referral, "", 64) || undefined,
    affiliateCode: str(body.affiliate_code, "", 40) || undefined,
    customerRef: str(body.customer_id, "", 190) || undefined,
    subscriptionRef: str(body.subscription_id, "", 190) || undefined,
    email: normalizeEmail(body.email) || undefined,
    couponCodes: str(body.coupon, "", 60) ? [str(body.coupon, "", 60)] : undefined,
    occurredAt: occurredAt ?? undefined,
  });
  const db = await getDb();
  const codeOf = async (affiliateId: number) => (await db.selectFrom("affiliates").select("code").where("id", "=", affiliateId).executeTakeFirst())?.code ?? "";
  switch (result.status) {
    case "created":
      return Response.json(
        { conversion: toApiConversion(result.conversion, result.affiliate.code, program.currency), duplicate: false, attributed_by: result.via },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    case "duplicate":
      return apiJson({ conversion: toApiConversion(result.conversion, await codeOf(result.conversion.affiliateId), program.currency), duplicate: true });
    case "rejected":
      return apiError(result.reason === "quota" ? 403 : 400, result.message);
    case "ignored":
      return apiJson({ conversion: null, ignored: true, reason: result.reason });
    default:
      return apiError(400, "Unexpected result.");
  }
}
