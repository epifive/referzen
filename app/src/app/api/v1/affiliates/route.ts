import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { listProgramAffiliates } from "@/lib/affiliates";
import { apiProgram, pageParams, toApiAffiliate } from "@/lib/api-v1";
import { isAffiliateStatus } from "@/referral/normalize";

/**
 * GET /api/v1/affiliates?program_id=1[&status=pending|approved|blocked][&search=][&limit=50][&offset=0]
 *   -> 200 { data: ApiAffiliate[], limit, offset }   newest first
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const program = await apiProgram(url.searchParams.get("program_id"), guard.user.id);
  if (program instanceof Response) return program;
  const status = url.searchParams.get("status");
  if (status && !isAffiliateStatus(status)) return apiError(400, "status must be pending, approved or blocked.");
  const { limit, offset } = pageParams(url);
  const affiliates = await listProgramAffiliates(program.id, {
    status: status && isAffiliateStatus(status) ? status : undefined,
    search: url.searchParams.get("search") ?? undefined,
    limit,
    offset,
  });
  return apiJson({ data: affiliates.map(toApiAffiliate), limit, offset });
}
