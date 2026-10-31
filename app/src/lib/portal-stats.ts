import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";

/**
 * Click counts that combine the daily summaries (click_daily, kept for good) with the raw
 * clicks of the days that are not summarised yet. The click-rollups job (src/lib/jobs/click-rollups.ts)
 * summarises finished UTC days and stores the last one in the settings row "click_rollup_until";
 * raw clicks are deleted after 90 days, but only once their day is summarised. Use these helpers
 * for every click number (portal and merchant dashboard) so both always agree.
 *
 * Days are UTC calendar days ("YYYY-MM-DD"). clicks = every recorded click; unique clicks = clicks
 * not flagged as a repeat of the same visitor on the same day (clicks.is_duplicate = 0).
 */

export const ROLLUP_UNTIL_KEY = "click_rollup_until";

export interface ClickCounts {
  clicks: number;
  uniqueClicks: number;
}

export interface ClickStats extends ClickCounts {
  /** day → counts (only days with clicks). */
  byDay: Map<string, ClickCounts>;
}

/** Last UTC day whose clicks are summarised in click_daily, or null when none is. */
export async function getClickRollupUntil(): Promise<string | null> {
  const db = await getDb();
  const row = await db.selectFrom("settings").select("value").where("key", "=", ROLLUP_UNTIL_KEY).executeTakeFirst();
  return row?.value && /^\d{4}-\d{2}-\d{2}$/.test(row.value) ? row.value : null;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Clicks of a program (optionally one affiliate) from `fromDay` to `toDay` inclusive.
 * `rollupUntil` may be passed when the caller already read it.
 */
export async function getClickStats(options: { programId: number; affiliateId?: number; fromDay: string; toDay: string; rollupUntil?: string | null }): Promise<ClickStats> {
  const { programId, affiliateId, fromDay, toDay } = options;
  const until = options.rollupUntil !== undefined ? options.rollupUntil : await getClickRollupUntil();
  const db = await getDb();
  const byDay = new Map<string, ClickCounts>();
  const add = (day: string, clicks: number, unique: number) => {
    const current = byDay.get(day) ?? { clicks: 0, uniqueClicks: 0 };
    current.clicks += clicks;
    current.uniqueClicks += unique;
    byDay.set(day, current);
  };

  // Summarised days.
  if (until && fromDay <= until) {
    const last = toDay < until ? toDay : until;
    const rows = await db
      .selectFrom("click_daily")
      .select((eb) => ["day", eb.fn.sum<number>("clicks").as("clicks"), eb.fn.sum<number>("unique_clicks").as("uniq")])
      .where("program_id", "=", programId)
      .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
      .where("day", ">=", fromDay)
      .where("day", "<=", last)
      .groupBy("day")
      .execute();
    for (const r of rows) add(r.day, Number(r.clicks ?? 0), Number(r.uniq ?? 0));
  }

  // Raw clicks of the days after the last summarised one.
  const rawFrom = until && until >= fromDay ? nextDay(until) : fromDay;
  if (rawFrom <= toDay) {
    const day = sql<string>`substr(ts, 1, 10)`;
    const rows = await db
      .selectFrom("clicks")
      .select([
        day.as("day"),
        (eb) => eb.fn.countAll<number>().as("clicks"),
        sql<number>`sum(case when is_duplicate = 0 then 1 else 0 end)`.as("uniq"),
      ])
      .where("program_id", "=", programId)
      .$if(affiliateId !== undefined, (qb) => qb.where("affiliate_id", "=", affiliateId!))
      .where("ts", ">=", `${rawFrom}T00:00:00.000Z`)
      .where("ts", "<", `${nextDay(toDay)}T00:00:00.000Z`)
      .groupBy(day)
      .execute();
    for (const r of rows) add(r.day, Number(r.clicks ?? 0), Number(r.uniq ?? 0));
  }

  let clicks = 0;
  let uniqueClicks = 0;
  for (const v of byDay.values()) {
    clicks += v.clicks;
    uniqueClicks += v.uniqueClicks;
  }
  return { clicks, uniqueClicks, byDay };
}

/** Clicks per affiliate of a program over a day range (top-affiliate tables). */
export async function getClicksByAffiliate(options: { programId: number; fromDay: string; toDay: string; rollupUntil?: string | null }): Promise<Map<number, ClickCounts>> {
  const { programId, fromDay, toDay } = options;
  const until = options.rollupUntil !== undefined ? options.rollupUntil : await getClickRollupUntil();
  const db = await getDb();
  const out = new Map<number, ClickCounts>();
  const add = (id: number, clicks: number, unique: number) => {
    const current = out.get(id) ?? { clicks: 0, uniqueClicks: 0 };
    current.clicks += clicks;
    current.uniqueClicks += unique;
    out.set(id, current);
  };
  if (until && fromDay <= until) {
    const rows = await db
      .selectFrom("click_daily")
      .select((eb) => ["affiliate_id", eb.fn.sum<number>("clicks").as("clicks"), eb.fn.sum<number>("unique_clicks").as("uniq")])
      .where("program_id", "=", programId)
      .where("day", ">=", fromDay)
      .where("day", "<=", toDay < until ? toDay : until)
      .groupBy("affiliate_id")
      .execute();
    for (const r of rows) add(r.affiliate_id, Number(r.clicks ?? 0), Number(r.uniq ?? 0));
  }
  const rawFrom = until && until >= fromDay ? nextDay(until) : fromDay;
  if (rawFrom <= toDay) {
    const rows = await db
      .selectFrom("clicks")
      .select(["affiliate_id", (eb) => eb.fn.countAll<number>().as("clicks"), sql<number>`sum(case when is_duplicate = 0 then 1 else 0 end)`.as("uniq")])
      .where("program_id", "=", programId)
      .where("ts", ">=", `${rawFrom}T00:00:00.000Z`)
      .where("ts", "<", `${nextDay(toDay)}T00:00:00.000Z`)
      .groupBy("affiliate_id")
      .execute();
    for (const r of rows) add(r.affiliate_id, Number(r.clicks ?? 0), Number(r.uniq ?? 0));
  }
  return out;
}
