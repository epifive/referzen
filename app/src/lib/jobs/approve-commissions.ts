import "server-only";
import { getDb } from "@/lib/db";
import { normalizeProgramSettings, parseJson } from "@/referral/normalize";
import { HELD_FLAGS } from "@/referral/types";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * approve-commissions: pending conversions whose hold period (the program's refund window,
 * `holdDays`, counted from occurred_at) has ended become "approved" and payable.
 * - reversed conversions are never touched (only status "pending" is)
 * - conversions carrying a review flag (HELD_FLAGS: self-referral, same visitor as the
 *   affiliate's own portal sign-in, customer already credited to another affiliate, paid in
 *   another currency) stay pending until the merchant approves or reverses them by hand, also
 *   with a 0-day hold; "client_side" (rz.js) is lower trust but approved normally
 * - at most BATCH rows per tick; the rest is picked up on the next tick
 */

export { HELD_FLAGS };

const BATCH = 1000;
const INTERVAL_MS = 10 * 60_000;

/** Approve due conversions now (also used by tests and "Run jobs now"). Returns the number approved. */
export async function approveDueCommissions(options: { limit?: number; nowMs?: number; deadline?: number } = {}): Promise<{ approved: number; more: boolean }> {
  const db = await getDb();
  const limit = Math.max(1, options.limit ?? BATCH);
  const nowMs = options.nowMs ?? Date.now();
  const programIds = (await db.selectFrom("conversions").select("program_id").distinct().where("status", "=", "pending").execute()).map((r) => r.program_id);
  if (!programIds.length) return { approved: 0, more: false };
  const programs = await db.selectFrom("programs").select(["id", "settings"]).where("id", "in", programIds).execute();
  let approved = 0;
  let more = false;
  for (const p of programs) {
    if (approved >= limit || (options.deadline && Date.now() >= options.deadline)) {
      more = true;
      break;
    }
    const holdDays = normalizeProgramSettings(parseJson(p.settings)).holdDays;
    const cutoff = new Date(nowMs - holdDays * 86_400_000).toISOString();
    let query = db
      .selectFrom("conversions")
      .select("id")
      .where("program_id", "=", p.id)
      .where("status", "=", "pending")
      .where("occurred_at", "<=", cutoff);
    for (const flag of HELD_FLAGS) query = query.where("flags", "not like", `%${flag}%`);
    const want = limit - approved;
    const ids = (await query.orderBy("id").limit(want + 1).execute()).map((r) => r.id);
    if (ids.length > want) {
      more = true;
      ids.length = want;
    }
    if (!ids.length) continue;
    const ts = new Date(nowMs).toISOString();
    const res = await db.updateTable("conversions").set({ status: "approved", approved_at: ts, updated_at: ts }).where("id", "in", ids).where("status", "=", "pending").executeTakeFirst();
    approved += Number(res.numUpdatedRows);
  }
  return { approved, more };
}

export const approveCommissionsJob: Job = {
  name: "approve-commissions",
  async run(ctx) {
    if (!(await isDue("approve-commissions", ctx))) return 0;
    const { approved, more } = await approveDueCommissions({ deadline: ctx.deadline });
    await scheduleNext("approve-commissions", more ? 0 : INTERVAL_MS);
    return approved;
  },
};
