import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import type { Entitlements } from "./plans";

/** Monthly usage per user (usage_monthly): conversions (the plan quota) and clicks. */

/** "YYYY-MM" of an instant (UTC). */
export function usageMonth(at: Date | number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

export async function getUsage(userId: number, month = usageMonth()): Promise<{ conversions: number; clicks: number }> {
  const db = await getDb();
  const row = await db.selectFrom("usage_monthly").select(["conversions", "clicks"]).where("user_id", "=", userId).where("month", "=", month).executeTakeFirst();
  return { conversions: Number(row?.conversions ?? 0), clicks: Number(row?.clicks ?? 0) };
}

/** Add to this month's counters (creates the row on first use). */
export async function incrementUsage(userId: number, delta: { conversions?: number; clicks?: number }, month = usageMonth()): Promise<void> {
  const conversions = Math.trunc(delta.conversions ?? 0);
  const clicks = Math.trunc(delta.clicks ?? 0);
  if (!conversions && !clicks) return;
  const db = await getDb();
  const updated = await db
    .updateTable("usage_monthly")
    .set({ conversions: sql`conversions + ${conversions}`, clicks: sql`clicks + ${clicks}` })
    .where("user_id", "=", userId)
    .where("month", "=", month)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) > 0) return;
  try {
    await db.insertInto("usage_monthly").values({ user_id: userId, month, conversions: Math.max(0, conversions), clicks: Math.max(0, clicks) }).execute();
  } catch {
    // Created by a concurrent request in the meantime.
    await db
      .updateTable("usage_monthly")
      .set({ conversions: sql`conversions + ${conversions}`, clicks: sql`clicks + ${clicks}` })
      .where("user_id", "=", userId)
      .where("month", "=", month)
      .execute();
  }
}

/** True when the user may record another conversion this month (0 = unlimited). */
export async function hasConversionQuota(userId: number, entitlements: Pick<Entitlements, "maxMonthlyConversions">): Promise<boolean> {
  if (entitlements.maxMonthlyConversions <= 0) return true;
  return (await getUsage(userId)).conversions < entitlements.maxMonthlyConversions;
}
