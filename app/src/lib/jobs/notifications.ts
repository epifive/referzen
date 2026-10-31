import "server-only";
import { sql } from "kysely";
import { getDb } from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mail";
import { emailTranslator, getProgramOwner, portalUrl, sendAffiliateMail } from "@/lib/notify";
import { getAffiliateEarnings, getDueBalances } from "@/lib/payouts";
import { getClicksByAffiliate, type ClickCounts } from "@/lib/portal-stats";
import { toProgramRecord, type ProgramRecord } from "@/lib/programs";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatMoney } from "@/referral/normalize";
import type { Job } from "./index";
import { addDays, isDue, isoWeekday, scheduleNext, writeKey } from "./shared";
import { plural } from "@/lib/i18n/messages";

/**
 * notifications: summary emails, each once per period, only while SMTP is configured.
 * - Daily digest to merchants (program owners) about the previous UTC day: new affiliates
 *   (and how many wait for approval), conversions, reversals and the balance ready to pay,
 *   per program. Owners whose programs had no new affiliate, conversion or reversal that day
 *   get no email.
 * - Weekly summary to approved affiliates about the previous week (Monday–Sunday, UTC):
 *   clicks, conversions, new commissions and their balances. Only for programs with
 *   `emailAffiliates` on, and only to affiliates who had clicks or conversions that week.
 * Progress is kept in settings rows: "notify_digest_done" / "notify_weekly_done" (last period
 * finished) and "notify_digest:<day>" / "notify_weekly:<monday>" (last user / affiliate id
 * handled), so a run that runs out of time resumes where it stopped and nobody gets two emails.
 */

const INTERVAL_MS = 15 * 60_000;
/** Periods are reported 30 minutes after they end (click summaries and late webhooks are in). */
const SETTLE_MS = 30 * 60_000;
const MAX_EMAILS_PER_TICK = 40;

const KEY = {
  digestDone: "notify_digest_done",
  digestCursor: (day: string) => `notify_digest:${day}`,
  weeklyDone: "notify_weekly_done",
  weeklyCursor: (monday: string) => `notify_weekly:${monday}`,
};

async function readKey(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst())?.value ?? null;
}

const dayStart = (day: string) => `${day}T00:00:00.000Z`;

/** The UTC day the daily digest reports on at `nowMs` (yesterday, once settled). */
export function digestDay(nowMs = Date.now()): string {
  return new Date(nowMs - SETTLE_MS - 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the last finished UTC week at `nowMs`. */
export function lastWeekMonday(nowMs = Date.now()): string {
  const today = new Date(nowMs - SETTLE_MS).toISOString().slice(0, 10);
  return addDays(today, -(isoWeekday(today) - 1) - 7);
}

// ── merchant digest ──

interface ProgramDay {
  program: ProgramRecord;
  newAffiliates: number;
  waiting: number;
  conversions: number;
  amountCents: number;
  commissionCents: number;
  reversed: number;
  dueCents: number;
  dueCount: number;
}

async function programDay(program: ProgramRecord, day: string): Promise<ProgramDay> {
  const db = await getDb();
  const from = dayStart(day);
  const to = dayStart(addDays(day, 1));
  const [affiliates, waiting, conversions, reversed, due] = await Promise.all([
    db.selectFrom("affiliates").select((eb) => eb.fn.countAll<number>().as("n")).where("program_id", "=", program.id).where("created_at", ">=", from).where("created_at", "<", to).executeTakeFirst(),
    db.selectFrom("affiliates").select((eb) => eb.fn.countAll<number>().as("n")).where("program_id", "=", program.id).where("status", "=", "pending").executeTakeFirst(),
    db
      .selectFrom("conversions")
      .select((eb) => [
        eb.fn.countAll<number>().as("n"),
        // Payments in another currency (currency_mismatch) can't be added to the program currency.
        sql<number>`sum(case when flags like '%currency_mismatch%' then 0 else amount_cents end)`.as("amount"),
        eb.fn.sum<number>("commission_cents").as("commission"),
      ])
      .where("program_id", "=", program.id)
      .where("created_at", ">=", from)
      .where("created_at", "<", to)
      .where("status", "!=", "reversed")
      .executeTakeFirst(),
    db.selectFrom("conversions").select((eb) => eb.fn.countAll<number>().as("n")).where("program_id", "=", program.id).where("reversed_at", ">=", from).where("reversed_at", "<", to).executeTakeFirst(),
    getDueBalances(program),
  ]);
  const payable = due.filter((d) => d.meetsMinimum);
  return {
    program,
    newAffiliates: Number(affiliates?.n ?? 0),
    waiting: Number(waiting?.n ?? 0),
    conversions: Number(conversions?.n ?? 0),
    amountCents: Number(conversions?.amount ?? 0),
    commissionCents: Number(conversions?.commission ?? 0),
    reversed: Number(reversed?.n ?? 0),
    dueCents: payable.reduce((s, d) => s + d.amountCents, 0),
    dueCount: payable.length,
  };
}

/** Send the digest of `day` to one owner. Returns true when an email was sent. */
export async function sendMerchantDigest(userId: number, day: string): Promise<boolean> {
  const db = await getDb();
  const owner = await getProgramOwner(userId);
  if (!owner) return false;
  const programs = (await db.selectFrom("programs").selectAll().where("user_id", "=", userId).orderBy("id").execute()).map(toProgramRecord);
  const days = await Promise.all(programs.map((p) => programDay(p, day)));
  const active = days.filter((d) => d.newAffiliates || d.conversions || d.reversed);
  if (!active.length) return false;

  const settings = await getSettings();
  const { t, locale } = await emailTranslator();
  const money = (cents: number, currency: string) => formatMoney(cents, currency, locale);
  const totalConversions = active.reduce((s, d) => s + d.conversions, 0);
  const lines: string[] = [t("pmail.hi", { name: owner.name }), "", t("mdigest.intro", { date: day })];
  for (const d of active) {
    const c = d.program.currency;
    lines.push("", `${d.program.name}`);
    lines.push(`- ${t("mdigest.affiliates", { n: d.newAffiliates, waiting: d.waiting })}`);
    lines.push(`- ${t("mdigest.conversions", { n: d.conversions, amount: money(d.amountCents, c), commission: money(d.commissionCents, c) })}`);
    if (d.reversed) lines.push(`- ${t("mdigest.reversed", { n: d.reversed })}`);
    if (d.dueCount) lines.push(`- ${plural(t, "mdigest.due", d.dueCount, { amount: money(d.dueCents, c) })}`);
    lines.push(absoluteUrl(settings, `/dashboard/programs/${d.program.id}`));
  }
  lines.push("", `— ${settings.site_name}`);
  await sendMail({ to: owner.email, subject: plural(t, "mdigest.subject", totalConversions, { date: day }), text: lines.join("\n") });
  return true;
}

async function runDigest(deadline: number, budget: { emails: number }): Promise<{ sent: number; more: boolean }> {
  const day = digestDay();
  if ((await readKey(KEY.digestDone)) === day) return { sent: 0, more: false };
  const db = await getDb();
  const cursorKey = KEY.digestCursor(day);
  let cursor = Number((await readKey(cursorKey)) ?? 0) || 0;
  const owners = (await db.selectFrom("programs").select("user_id").distinct().where("user_id", ">", cursor).orderBy("user_id").execute()).map((r) => r.user_id);
  let sent = 0;
  for (const userId of owners) {
    if (Date.now() >= deadline || budget.emails <= 0) return { sent, more: true };
    // Claim first: an overlapping run never sends the same digest twice.
    cursor = userId;
    await writeKey(cursorKey, String(cursor));
    try {
      if (await sendMerchantDigest(userId, day)) {
        sent += 1;
        budget.emails -= 1;
      }
    } catch (error) {
      console.error(`[referzen] digest to user ${userId} failed:`, error instanceof Error ? error.message : error);
    }
  }
  await writeKey(KEY.digestDone, day);
  // Forget the cursors of earlier days.
  await db.deleteFrom("settings").where("key", "like", "notify_digest:%").where("key", "!=", cursorKey).execute();
  return { sent, more: false };
}

// ── affiliate weekly summary ──

async function runWeekly(deadline: number, budget: { emails: number }): Promise<{ sent: number; more: boolean }> {
  const monday = lastWeekMonday();
  if ((await readKey(KEY.weeklyDone)) === monday) return { sent: 0, more: false };
  const sunday = addDays(monday, 6);
  const from = dayStart(monday);
  const to = dayStart(addDays(monday, 7));
  const db = await getDb();
  const cursorKey = KEY.weeklyCursor(monday);
  let cursor = Number((await readKey(cursorKey)) ?? 0) || 0;
  const programs = new Map<number, ProgramRecord | null>();
  const clicksByProgram = new Map<number, Map<number, ClickCounts>>();
  const { t, locale } = await emailTranslator();
  let sent = 0;

  while (true) {
    const batch = await db
      .selectFrom("affiliates")
      .select(["id", "program_id", "name", "email", "code", "status"])
      .where("status", "=", "approved")
      .where("id", ">", cursor)
      .orderBy("id")
      .limit(200)
      .execute();
    if (!batch.length) break;
    // Conversions of the week for the whole batch at once.
    const conv = await db
      .selectFrom("conversions")
      .select((eb) => ["affiliate_id", eb.fn.countAll<number>().as("n"), eb.fn.sum<number>("commission_cents").as("commission")])
      .where("affiliate_id", "in", batch.map((a) => a.id))
      .where("status", "!=", "reversed")
      .where("occurred_at", ">=", from)
      .where("occurred_at", "<", to)
      .groupBy("affiliate_id")
      .execute();
    const convBy = new Map(conv.map((c) => [c.affiliate_id, { n: Number(c.n ?? 0), commission: Number(c.commission ?? 0) }]));

    for (const a of batch) {
      if (Date.now() >= deadline || budget.emails <= 0) {
        await writeKey(cursorKey, String(cursor));
        return { sent, more: true };
      }
      cursor = a.id;
      if (!programs.has(a.program_id)) {
        const row = await db.selectFrom("programs").selectAll().where("id", "=", a.program_id).executeTakeFirst();
        programs.set(a.program_id, row ? toProgramRecord(row) : null);
      }
      const program = programs.get(a.program_id);
      if (!program || !program.settings.emailAffiliates) continue;
      let clickMap = clicksByProgram.get(program.id);
      if (!clickMap) {
        clickMap = await getClicksByAffiliate({ programId: program.id, fromDay: monday, toDay: sunday });
        clicksByProgram.set(program.id, clickMap);
      }
      const clicks = clickMap.get(a.id)?.clicks ?? 0;
      const week = convBy.get(a.id) ?? { n: 0, commission: 0 };
      if (!clicks && !week.n) continue;

      // Claim before sending (no double emails when two runs overlap).
      await writeKey(cursorKey, String(cursor));
      const earnings = await getAffiliateEarnings(program.id, a.id);
      const money = (cents: number) => formatMoney(cents, program.currency, locale);
      const ok = await sendAffiliateMail(program, { id: a.id, name: a.name, email: a.email, code: a.code, status: "approved" }, t("pmail.weeklySubject", { program: program.name, earned: money(week.commission) }), [
        t("pmail.weeklyIntro", { program: program.name, from: monday, to: sunday }),
        "",
        `- ${t("pmail.weeklyClicks", { n: clicks })}`,
        `- ${t("pmail.weeklyConversions", { n: week.n })}`,
        `- ${t("pmail.weeklyEarned", { amount: money(week.commission) })}`,
        "",
        t("pmail.weeklyBalances", { pending: money(earnings.pendingCents), approved: money(earnings.approvedCents), paid: money(earnings.paidCents) }),
        "",
        t("pmail.portalLink", { url: await portalUrl(program.slug, "dashboard") }),
      ]);
      if (ok) {
        sent += 1;
        budget.emails -= 1;
      }
    }
    await writeKey(cursorKey, String(cursor));
  }
  await writeKey(KEY.weeklyDone, monday);
  await db.deleteFrom("settings").where("key", "like", "notify_weekly:%").where("key", "!=", cursorKey).execute();
  return { sent, more: false };
}

export const notificationsJob: Job = {
  name: "notifications",
  async run(ctx) {
    if (!(await isDue("notifications", ctx))) return 0;
    if (!mailConfigured(await getSettings())) {
      await scheduleNext("notifications", INTERVAL_MS);
      return 0;
    }
    const budget = { emails: MAX_EMAILS_PER_TICK };
    const digest = await runDigest(ctx.deadline, budget);
    const weekly = digest.more ? { sent: 0, more: true } : await runWeekly(ctx.deadline, budget);
    await scheduleNext("notifications", digest.more || weekly.more ? 0 : INTERVAL_MS);
    return digest.sent + weekly.sent;
  },
};
