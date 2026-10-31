import "server-only";
import { approveCommissionsJob } from "./approve-commissions";
import { clickRollupsJob } from "./click-rollups";
import { housekeepingJob } from "./housekeeping";
import { notificationsJob } from "./notifications";
import { usageJob } from "./usage";

/**
 * Background jobs run by the scheduler (src/lib/scheduler.ts) on every tick, in order,
 * while time is left in the tick's budget. A job does a small, idempotent slice of work
 * and returns how many items it handled; anything it can't finish is picked up next tick.
 * Jobs throttle themselves (settings rows "job_next:<name>", see ./shared.ts).
 */
export interface JobContext {
  /** Epoch ms after which a job should stop starting new work. */
  deadline: number;
  /** Who started the tick. */
  source: "cron" | "worker" | "lazy" | "manual";
}

export interface Job {
  /** Short id shown in Admin → System (e.g. "approve-commissions"). */
  name: string;
  run(ctx: JobContext): Promise<number>;
}

/**
 * Registered jobs, in the order they run: commission approval after the hold period, click
 * summaries and retention, digest / weekly emails, plan usage notices, housekeeping.
 */
export const JOBS: Job[] = [approveCommissionsJob, clickRollupsJob, notificationsJob, usageJob, housekeepingJob];
