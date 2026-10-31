import "server-only";
import { sql } from "kysely";
import { getDb } from "@/lib/db";
import { getClickRollupUntil, ROLLUP_UNTIL_KEY } from "@/lib/portal-stats";
import type { Job } from "./index";
import { addDays, chunk, isDue, scheduleNext, writeKey } from "./shared";

/**
 * click-rollups: daily click summaries and click retention.
 * - Every finished UTC day (10 minutes after midnight, so clicks still being written at
 *   midnight are in) is summarised into click_daily per (program, affiliate, day):
 *   clicks = all clicks, unique_clicks = clicks with is_duplicate = 0. The last summarised
 *   day is stored in the settings row "click_rollup_until"; days without clicks are skipped.
 *   Re-running a day replaces its rows, so the job is idempotent. Clicks inserted later for a
 *   day that is already summarised (back-dated imports, demo data, a request that crossed
 *   midnight) are noticed by their id (settings row "click_rollup_max_id", the highest click id
 *   seen by the last complete run) and their day is summarised again.
 * - Raw clicks older than RETENTION_DAYS are deleted one whole day at a time, and only for
 *   days that are summarised; the day is summarised again right before its raw clicks are
 *   deleted, so clicks that arrived late are never lost.
 * Visitor salts (settings rows "visitor_salt:YYYY-MM-DD") are pruned by src/lib/salts.ts itself.
 */

export const RETENTION_DAYS = 90;
const INTERVAL_MS = 10 * 60_000;
const SETTLE_MS = 10 * 60_000;
const MAX_ID_KEY = "click_rollup_max_id";

const dayStart = (day: string) => `${day}T00:00:00.000Z`;

/** Replace the click_daily rows of one UTC day with fresh counts from the raw clicks. Returns the clicks counted. */
export async function rollupDay(day: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .selectFrom("clicks")
    .select(["program_id", "affiliate_id", (eb) => eb.fn.countAll<number>().as("clicks"), sql<number>`sum(case when is_duplicate = 0 then 1 else 0 end)`.as("uniq")])
    .where("ts", ">=", dayStart(day))
    .where("ts", "<", dayStart(addDays(day, 1)))
    .groupBy(["program_id", "affiliate_id"])
    .execute();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("click_daily").where("day", "=", day).execute();
    for (const part of chunk(rows, 200)) {
      await trx
        .insertInto("click_daily")
        .values(part.map((r) => ({ program_id: r.program_id, affiliate_id: r.affiliate_id, day, clicks: Number(r.clicks ?? 0), unique_clicks: Number(r.uniq ?? 0) })))
        .execute();
    }
  });
  return rows.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0);
}

/** Last UTC day that is finished (and settled) at `nowMs`. */
export function lastFinishedDay(nowMs = Date.now()): string {
  return new Date(nowMs - SETTLE_MS - 86_400_000).toISOString().slice(0, 10);
}

/** Summarise finished days after "click_rollup_until". Returns { days, clicks, more }. */
export async function rollupPendingDays(deadline = Date.now() + 20_000, nowMs = Date.now()): Promise<{ days: number; clicks: number; more: boolean }> {
  const db = await getDb();
  const last = lastFinishedDay(nowMs);
  let until = await getClickRollupUntil();
  let days = 0;
  let clicks = 0;
  const maxRow = await db.selectFrom("clicks").select((eb) => eb.fn.max("id").as("id")).executeTakeFirst();
  const maxId = Number(maxRow?.id ?? 0);
  const seenId = Number((await db.selectFrom("settings").select("value").where("key", "=", MAX_ID_KEY).executeTakeFirst())?.value ?? 0) || 0;

  // Days that are already summarised but received clicks since the last run.
  if (until && maxId > seenId) {
    const late = await db
      .selectFrom("clicks")
      .select(sql<string>`substr(ts, 1, 10)`.as("day"))
      .distinct()
      .where("id", ">", seenId)
      .where("id", "<=", maxId)
      .where("ts", "<", dayStart(addDays(until, 1)))
      .execute();
    for (const row of late) {
      if (Date.now() >= deadline) return { days, clicks, more: true };
      clicks += await rollupDay(row.day);
      days += 1;
    }
  }

  while (Date.now() < deadline) {
    const from = until ? addDays(until, 1) : "0000-01-01";
    if (from > last) {
      await writeKey(MAX_ID_KEY, String(maxId));
      return { days, clicks, more: false };
    }
    // Next day that has clicks (empty days need no rows).
    const next = await db.selectFrom("clicks").select((eb) => eb.fn.min("ts").as("ts")).where("ts", ">=", dayStart(from)).executeTakeFirst();
    const nextDay = typeof next?.ts === "string" ? next.ts.slice(0, 10) : null;
    if (!nextDay || nextDay > last) {
      await writeKey(ROLLUP_UNTIL_KEY, last);
      await writeKey(MAX_ID_KEY, String(maxId));
      return { days, clicks, more: false };
    }
    clicks += await rollupDay(nextDay);
    await writeKey(ROLLUP_UNTIL_KEY, nextDay);
    until = nextDay;
    days += 1;
  }
  return { days, clicks, more: true };
}

/** Delete raw clicks older than the retention window, whole summarised days only. Returns rows deleted. */
export async function pruneOldClicks(deadline = Date.now() + 20_000, nowMs = Date.now()): Promise<{ deleted: number; more: boolean }> {
  const db = await getDb();
  const until = await getClickRollupUntil();
  if (!until) return { deleted: 0, more: false };
  const keepFrom = new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  let deleted = 0;
  while (Date.now() < deadline) {
    const oldest = await db.selectFrom("clicks").select((eb) => eb.fn.min("ts").as("ts")).executeTakeFirst();
    const day = typeof oldest?.ts === "string" ? oldest.ts.slice(0, 10) : null;
    if (!day || day >= keepFrom || day > until) return { deleted, more: false };
    // Count the day again (late clicks), then drop its raw rows.
    await rollupDay(day);
    const res = await db.deleteFrom("clicks").where("ts", ">=", dayStart(day)).where("ts", "<", dayStart(addDays(day, 1))).executeTakeFirst();
    deleted += Number(res.numDeletedRows ?? 0);
  }
  return { deleted, more: true };
}

export const clickRollupsJob: Job = {
  name: "click-rollups",
  async run(ctx) {
    if (!(await isDue("click-rollups", ctx))) return 0;
    const rolled = await rollupPendingDays(ctx.deadline);
    const pruned = rolled.more ? { deleted: 0, more: true } : await pruneOldClicks(ctx.deadline);
    await scheduleNext("click-rollups", rolled.more || pruned.more ? 0 : INTERVAL_MS);
    return rolled.clicks;
  },
};
