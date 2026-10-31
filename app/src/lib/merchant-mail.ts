import "server-only";
import crypto from "node:crypto";
import { getAffiliate } from "./affiliates";
import { getDb, now } from "./db";
import { mailConfigured } from "./mail";
import { notifyPayoutPaid, portalUrl, sendAffiliateInvite } from "./notify";
import type { PayoutRecord } from "./payouts";
import type { ProgramRecord } from "./programs";
import { getSettings } from "./settings";
import { sha256 } from "./tokens";
import type { AffiliateRecord } from "./affiliates";

/** Invitations and payout notifications sent from merchant dashboard actions (texts live in src/lib/notify). */

const INVITE_TTL_MS = 7 * 86_400_000;

export async function canSendMail(): Promise<boolean> {
  return mailConfigured(await getSettings());
}

/**
 * Invite an affiliate to set their portal password: stores a one-time token (sha256 in
 * affiliate_password_resets, valid 7 days), emails the link when `email` is true and SMTP works,
 * and returns the link so the merchant can share it by hand.
 */
export async function inviteAffiliate(program: ProgramRecord, affiliate: AffiliateRecord, options: { email: boolean; merchantName?: string }): Promise<{ link: string; emailed: boolean }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const db = await getDb();
  await db.deleteFrom("affiliate_password_resets").where("affiliate_id", "=", affiliate.id).execute();
  await db
    .insertInto("affiliate_password_resets")
    .values({ token_hash: sha256(token), affiliate_id: affiliate.id, expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(), created_at: now() })
    .execute();
  const link = await portalUrl(program.slug, `reset?token=${encodeURIComponent(token)}`);
  const emailed = options.email && (await canSendMail()) ? await sendAffiliateInvite(program, affiliate, token, options.merchantName) : false;
  return { link, emailed };
}

/** After payouts are marked paid: one affiliate email + merchant alert per payout (see notifyPayoutPaid). */
export async function notifyPayoutsPaid(program: ProgramRecord, payouts: PayoutRecord[]): Promise<number> {
  let n = 0;
  for (const payout of payouts) {
    const affiliate = await getAffiliate(payout.affiliateId);
    if (!affiliate || affiliate.programId !== program.id) continue;
    await notifyPayoutPaid(program, affiliate, payout);
    n += 1;
  }
  return n;
}
