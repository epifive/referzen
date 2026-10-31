import { apiGuard, apiJson } from "@/lib/api-guard";
import { toApiProgram } from "@/lib/api-v1";
import { getUserPrograms } from "@/lib/programs";
import { baseUrl } from "@/lib/request";

/**
 * GET /api/v1/programs: the programs of the API key's account (read-only).
 *   -> 200 { data: [{ id, name, slug, currency, status, portal_url }] }   oldest first
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const [programs, origin] = await Promise.all([getUserPrograms(guard.user.id), baseUrl()]);
  return apiJson({ data: programs.map((p) => toApiProgram(p, origin)) });
}
