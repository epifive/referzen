import { apiError, apiGuard } from "@/lib/api-guard";
import { apiProgram, readApiJson } from "@/lib/api-v1";
import { processReferralEvent } from "@/lib/attribution";
import { normalizeEmail, str } from "@/referral/normalize";

/**
 * POST /api/v1/referrals: record a lead (a referred customer who signed up), e.g. from your
 * sign-up handler with the rz_ref cookie.
 *
 *   { "program_id": 1, "referral": "<rz_ref token>" | "affiliate_code": "jane", "email": "…", "customer_id": "cus_…" }
 *   -> 201 { referral: { id, program_id, affiliate_id, affiliate_code, token, email, customer_id, status, created_at }, created }
 *   -> 422 { error }   no matching referral (unknown / expired token, unknown code, affiliate not approved)
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const program = await apiProgram(body.program_id, guard.user.id, { write: true });
  if (program instanceof Response) return program;

  const referral = str(body.referral, "", 64);
  const code = str(body.affiliate_code, "", 40);
  const email = normalizeEmail(body.email);
  const customer = str(body.customer_id, "", 190);
  if (!referral && !code) return apiError(400, "Send the referral token (referral) or the affiliate's code (affiliate_code).");
  if (!email && !customer) return apiError(400, "Send the customer's email or customer_id.");
  if (body.email !== undefined && body.email !== null && body.email !== "" && !email) return apiError(400, "email is not a valid email address.");

  const result = await processReferralEvent(program, "api", {
    kind: "lead",
    externalId: "",
    amountCents: 0,
    currency: "",
    referralToken: referral || undefined,
    affiliateCode: code || undefined,
    email: email || undefined,
    customerRef: customer || undefined,
  });
  if (result.status !== "lead") return apiError(422, result.status === "ignored" ? result.reason : "The lead could not be recorded.");
  const r = result.referral;
  return Response.json(
    {
      referral: {
        id: r.id,
        program_id: r.program_id,
        affiliate_id: r.affiliate_id,
        affiliate_code: result.affiliate.code,
        token: r.token,
        email: r.email,
        customer_id: r.customer_ref,
        status: r.status,
        created_at: r.created_at,
      },
      created: result.created,
    },
    { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
