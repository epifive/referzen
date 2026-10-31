import "server-only";
import { buildAlertPayload, notifyChannels } from "@/lib/alerts";
import { getDb } from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mail";
import { emailTranslator } from "@/lib/notify";
import { getEntitlements } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { usageMonth } from "@/lib/usage";
import { normalizeProgramSettings, parseJson } from "@/referral/normalize";
import type { Job } from "./index";
import { chunk, isDue, scheduleNext, writeKey } from "./shared";

/**
 * usage: tells an account owner when this month's recorded conversions (usage_monthly, UTC
 * month, all programs) reach 80 % and 100 % of the plan's `maxMonthlyConversions` — each level
 * once per month (settings rows "quota_mail:<userId>:<YYYY-MM>:<80|100>"; reaching 100 % also
 * settles 80 %). The owner is emailed (when SMTP is configured) and the alert channels of their
 * programs receive a quota_warning / quota_reached alert. Administrators and unlimited plans
 * are skipped. With neither SMTP nor a channel, nothing is claimed, so the notice goes out once
 * one of them is set up.
 */

const INTERVAL_MS = 15 * 60_000;
const MAX_PER_TICK = 50;

const keyOf = (userId: number, month: string, level: 80 | 100) => `quota_mail:${userId}:${month}:${level}`;

export const usageJob: Job = {
  name: "usage",
  async run(ctx) {
    if (!(await isDue("usage", ctx))) return 0;
    const settings = await getSettings();
    const canMail = mailConfigured(settings);
    const db = await getDb();
    const month = usageMonth();
    const rows = await db
      .selectFrom("usage_monthly")
      .innerJoin("users", "users.id", "usage_monthly.user_id")
      .select(["users.id", "users.name", "users.email", "users.role", "users.plan_id", "users.plan_expires_at", "usage_monthly.conversions"])
      .where("usage_monthly.month", "=", month)
      .where("usage_monthly.conversions", ">", 0)
      .where("users.status", "=", "active")
      .where("users.role", "!=", "admin")
      .execute();
    const sentKeys = new Set((await db.selectFrom("settings").select("key").where("key", "like", `quota_mail:%:${month}:%`).execute()).map((r) => r.key));
    const { t, locale } = await emailTranslator();
    const num = (n: number) => n.toLocaleString(locale);

    let handled = 0;
    let backlog = false;
    for (const row of rows) {
      if (Date.now() >= ctx.deadline || handled >= MAX_PER_TICK) {
        backlog = true;
        break;
      }
      const used = Number(row.conversions);
      const ent = await getEntitlements({ role: row.role, plan_id: row.plan_id, plan_expires_at: row.plan_expires_at });
      const limit = ent.maxMonthlyConversions;
      if (!limit) continue;
      const level: 80 | 100 | 0 = used >= limit ? 100 : used >= limit * 0.8 ? 80 : 0;
      if (!level || sentKeys.has(keyOf(row.id, month, level))) continue;

      // Alert channels of the owner's programs.
      const programs = await db.selectFrom("programs").select("settings").where("user_id", "=", row.id).execute();
      const channelIds = [...new Set(programs.flatMap((p) => normalizeProgramSettings(parseJson(p.settings)).alertChannelIds))];
      if (!canMail && !channelIds.length) continue;

      await writeKey(keyOf(row.id, month, level), new Date().toISOString());
      if (level === 100) await writeKey(keyOf(row.id, month, 80), new Date().toISOString());
      handled += 1;

      const reached = level === 100;
      const percent = Math.floor((used / limit) * 100);
      const message = reached
        ? `Your programs recorded ${used.toLocaleString("en-US")} conversions this month, your plan's limit of ${limit.toLocaleString("en-US")}. New conversions are not recorded until the 1st of next month or until you upgrade.`
        : `Your programs recorded ${used.toLocaleString("en-US")} of the ${limit.toLocaleString("en-US")} conversions included in your plan this month (${percent}%).`;
      if (channelIds.length) {
        const payload = await buildAlertPayload(null, reached ? "quota_reached" : "quota_warning", message, { used, limit });
        payload.url = absoluteUrl(settings, "/pricing");
        await notifyChannels(channelIds, payload, null, row.id);
      }
      if (canMail) {
        const text = [
          t("pmail.hi", { name: row.name || row.email }),
          "",
          reached ? t("quota.reachedText", { used: num(used), limit: num(limit) }) : t("quota.warningText", { used: num(used), limit: num(limit), percent }),
          "",
          reached ? t("quota.reachedAdvice") : t("quota.warningAdvice"),
          "",
          t("quota.plans", { url: absoluteUrl(settings, "/pricing") }),
          t("quota.dashboard", { url: absoluteUrl(settings, "/dashboard") }),
          "",
          `— ${settings.site_name}`,
        ].join("\n");
        try {
          await sendMail({ to: row.email, subject: reached ? t("quota.reachedSubject") : t("quota.warningSubject", { percent }), text });
        } catch (error) {
          console.error(`[referzen] usage email to user ${row.id} failed:`, error instanceof Error ? error.message : error);
        }
      }
    }

    // Forget the rows of months before the previous one.
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const old = (await db.selectFrom("settings").select("key").where("key", "like", "quota_mail:%").execute())
      .map((r) => r.key)
      .filter((key) => {
        const m = key.split(":")[2] ?? "";
        return /^\d{4}-\d{2}$/.test(m) && m < prev;
      });
    for (const part of chunk(old, 200)) await db.deleteFrom("settings").where("key", "in", part).execute();

    await scheduleNext("usage", backlog ? 0 : INTERVAL_MS);
    return handled;
  },
};
