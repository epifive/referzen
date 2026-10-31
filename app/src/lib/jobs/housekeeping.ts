import "server-only";
import { cleanupExpiredSessions } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cleanupAffiliateSessions } from "@/lib/portal-session";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * housekeeping (hourly): expired platform and affiliate-portal sessions, expired password
 * reset / invitation links, and alert_log rows older than 90 days.
 */

const INTERVAL_MS = 60 * 60_000;
const ALERT_LOG_DAYS = 90;

export const housekeepingJob: Job = {
  name: "housekeeping",
  async run(ctx) {
    if (!(await isDue("housekeeping", ctx))) return 0;
    const db = await getDb();
    await cleanupExpiredSessions();
    const removed = await cleanupAffiliateSessions();
    const log = await db
      .deleteFrom("alert_log")
      .where("created_at", "<", new Date(Date.now() - ALERT_LOG_DAYS * 86_400_000).toISOString())
      .executeTakeFirst();
    await scheduleNext("housekeeping", INTERVAL_MS);
    return removed + Number(log.numDeletedRows ?? 0);
  },
};
