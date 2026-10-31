import "server-only";
import { getDb, now } from "./db";
import type { Affiliate } from "./db/schema";
import { hashPassword, verifyPassword } from "./auth/password";
import { randomToken } from "./tokens";
import { isPayoutMethod, normalizeCode, normalizeCommissionOverride, normalizeEmail, normalizePayoutDetails, parseJson, str } from "@/referral/normalize";
import type { AffiliateStatus, CommissionOverride, PayoutDetails, PayoutMethod, ProgramSettings } from "@/referral/types";

/** A stored affiliate without the password hash. */
export interface AffiliateRecord {
  id: number;
  programId: number;
  email: string;
  name: string;
  status: AffiliateStatus;
  /** Referral code (?ref=CODE). */
  code: string;
  couponCode: string | null;
  commissionOverride: CommissionOverride | null;
  payoutMethod: PayoutMethod;
  payoutDetails: PayoutDetails;
  website: string | null;
  notes: string | null;
  /** False for invited affiliates who haven't set a password yet. */
  hasPassword: boolean;
  lastVisitorHash: string | null;
  approvedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAffiliateRecord(row: Affiliate): AffiliateRecord {
  const method: PayoutMethod = isPayoutMethod(row.payout_method) ? row.payout_method : "paypal";
  return {
    id: row.id,
    programId: row.program_id,
    email: row.email,
    name: row.name,
    status: row.status === "approved" || row.status === "blocked" ? row.status : "pending",
    code: row.code,
    couponCode: row.coupon_code,
    commissionOverride: row.commission_override ? normalizeCommissionOverride(parseJson(row.commission_override)) : null,
    payoutMethod: method,
    payoutDetails: normalizePayoutDetails(method, parseJson(row.payout_details)),
    website: row.website,
    notes: row.notes,
    hasPassword: Boolean(row.password_hash),
    lastVisitorHash: row.last_visitor_hash,
    approvedAt: row.approved_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown by createAffiliate() when the email is already registered in the program. */
export class AffiliateExistsError extends Error {
  constructor() {
    super("An affiliate with this email already exists in this program.");
  }
}

/** Affiliates across all programs of a user (the plan's affiliate limit counts these). */
export async function countUserAffiliates(userId: number): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom("affiliates")
    .innerJoin("programs", "programs.id", "affiliates.program_id")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("programs.user_id", "=", userId)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function countProgramAffiliates(programId: number, status?: AffiliateStatus): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom("affiliates")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("program_id", "=", programId)
    .$if(status !== undefined, (qb) => qb.where("status", "=", status!))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/**
 * An affiliate of `programId`, or undefined. Use it for affiliate ids from user input after the
 * program itself was checked with getOwnedProgram() (prevents IDOR across programs).
 */
export async function getOwnedAffiliate(programId: number, affiliateId: number): Promise<AffiliateRecord | undefined> {
  if (!Number.isInteger(affiliateId) || affiliateId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("affiliates").selectAll().where("id", "=", affiliateId).where("program_id", "=", programId).executeTakeFirst();
  return row ? toAffiliateRecord(row) : undefined;
}

export async function getAffiliate(affiliateId: number): Promise<AffiliateRecord | undefined> {
  if (!Number.isInteger(affiliateId) || affiliateId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("affiliates").selectAll().where("id", "=", affiliateId).executeTakeFirst();
  return row ? toAffiliateRecord(row) : undefined;
}

export async function getAffiliateByEmail(programId: number, email: string): Promise<AffiliateRecord | undefined> {
  const clean = normalizeEmail(email);
  if (!clean) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("affiliates").selectAll().where("program_id", "=", programId).where("email", "=", clean).executeTakeFirst();
  return row ? toAffiliateRecord(row) : undefined;
}

/** Affiliate of a referral code (case-insensitive). */
export async function getAffiliateByCode(programId: number, code: string): Promise<AffiliateRecord | undefined> {
  const clean = normalizeCode(code);
  if (!clean) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("affiliates").selectAll().where("program_id", "=", programId).where("code", "=", clean).executeTakeFirst();
  return row ? toAffiliateRecord(row) : undefined;
}

export async function listProgramAffiliates(
  programId: number,
  options: { status?: AffiliateStatus; search?: string; limit?: number; offset?: number } = {},
): Promise<AffiliateRecord[]> {
  const db = await getDb();
  const search = options.search?.trim().toLowerCase().slice(0, 100);
  const rows = await db
    .selectFrom("affiliates")
    .selectAll()
    .where("program_id", "=", programId)
    .$if(options.status !== undefined, (qb) => qb.where("status", "=", options.status!))
    .$if(Boolean(search), (qb) =>
      qb.where((eb) => eb.or([eb("email", "like", `%${search}%`), eb("name", "like", `%${search}%`), eb("code", "like", `%${search}%`)])),
    )
    .orderBy("id", "desc")
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 500))
    .offset(Math.max(options.offset ?? 0, 0))
    .execute();
  return rows.map(toAffiliateRecord);
}

export async function isCodeTaken(programId: number, code: string, exceptAffiliateId?: number): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom("affiliates")
    .select("id")
    .where("program_id", "=", programId)
    .where("code", "=", code)
    .$if(exceptAffiliateId !== undefined, (qb) => qb.where("id", "!=", exceptAffiliateId!))
    .executeTakeFirst();
  return Boolean(row);
}

/** A free referral code based on `base` (a name, an email or a wanted code): "jane", "jane2", … */
export async function uniqueReferralCode(programId: number, base: string): Promise<string> {
  const fromBase = normalizeCode(base.includes("@") ? base.split("@")[0] : base).slice(0, 24).replace(/[-_]+$/, "");
  const root = fromBase.length >= 3 ? fromBase : `${fromBase}${randomToken(6).toLowerCase()}`.slice(0, 24);
  if (!(await isCodeTaken(programId, root))) return root;
  for (let n = 2; n < 30; n++) {
    const candidate = `${root}${n}`;
    if (!(await isCodeTaken(programId, candidate))) return candidate;
  }
  return `${root}-${randomToken(5).toLowerCase()}`;
}

export interface NewAffiliateInput {
  email: string;
  name: string;
  /** Plain password (portal sign-up) or omitted (merchant invite: the affiliate sets one later). */
  password?: string;
  /** Wanted referral code (made unique); default from the name / email. */
  code?: string;
  /** Default: "approved" when the program auto-approves, else "pending". */
  status?: AffiliateStatus;
  website?: string;
  payoutMethod?: PayoutMethod;
  payoutDetails?: unknown;
}

/**
 * Create an affiliate with a unique referral code. Throws AffiliateExistsError when the email
 * is already registered in the program. Plan limits are the caller's job (countUserAffiliates()).
 */
export async function createAffiliate(
  program: { id: number; settings: Pick<ProgramSettings, "autoApprove" | "payoutMethods"> },
  input: NewAffiliateInput,
): Promise<AffiliateRecord> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Enter a valid email address.");
  if (await getAffiliateByEmail(program.id, email)) throw new AffiliateExistsError();
  const db = await getDb();
  const ts = now();
  const status: AffiliateStatus = input.status ?? (program.settings.autoApprove ? "approved" : "pending");
  const method: PayoutMethod = input.payoutMethod && program.settings.payoutMethods.includes(input.payoutMethod) ? input.payoutMethod : program.settings.payoutMethods[0] ?? "paypal";
  const name = str(input.name, "", 120) || email.split("@")[0];
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await uniqueReferralCode(program.id, input.code || name || email);
    try {
      const result = await db
        .insertInto("affiliates")
        .values({
          program_id: program.id,
          email,
          name,
          password_hash: passwordHash,
          status,
          code,
          coupon_code: null,
          commission_override: null,
          payout_method: method,
          payout_details: JSON.stringify(normalizePayoutDetails(method, input.payoutDetails ?? { paypalEmail: email })),
          website: str(input.website, "", 255) || null,
          notes: null,
          last_visitor_hash: null,
          approved_at: status === "approved" ? ts : null,
          last_login_at: null,
          created_at: ts,
          updated_at: ts,
        })
        .executeTakeFirstOrThrow();
      return (await getAffiliate(Number(result.insertId)))!;
    } catch (error) {
      // Unique (program, email) or (program, code) hit by a concurrent request.
      if (await getAffiliateByEmail(program.id, email)) throw new AffiliateExistsError();
      if (attempt === 2) throw error;
    }
  }
  throw new Error("Could not create the affiliate.");
}

/** Approve, block or reset to pending. Approving the first time stamps approved_at. */
export async function setAffiliateStatus(affiliateId: number, status: AffiliateStatus): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db
    .updateTable("affiliates")
    .set({ status, updated_at: ts })
    .where("id", "=", affiliateId)
    .execute();
  if (status === "approved") {
    await db.updateTable("affiliates").set({ approved_at: ts }).where("id", "=", affiliateId).where("approved_at", "is", null).execute();
  }
  if (status === "blocked") await db.deleteFrom("affiliate_sessions").where("affiliate_id", "=", affiliateId).execute();
}

export interface AffiliateUpdate {
  name?: string;
  email?: string;
  /** Must be normalised and free (isCodeTaken()). */
  code?: string;
  couponCode?: string | null;
  commissionOverride?: CommissionOverride | null;
  payoutMethod?: PayoutMethod;
  payoutDetails?: unknown;
  website?: string | null;
  notes?: string | null;
  lastVisitorHash?: string | null;
}

export async function updateAffiliate(affiliate: Pick<AffiliateRecord, "id" | "payoutMethod">, input: AffiliateUpdate): Promise<void> {
  const db = await getDb();
  const method = input.payoutMethod ?? affiliate.payoutMethod;
  const override = input.commissionOverride === undefined ? undefined : input.commissionOverride ? normalizeCommissionOverride(input.commissionOverride) : null;
  await db
    .updateTable("affiliates")
    .set({
      ...(input.name !== undefined ? { name: str(input.name, "", 120) } : {}),
      ...(input.email !== undefined && normalizeEmail(input.email) ? { email: normalizeEmail(input.email) } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.couponCode !== undefined ? { coupon_code: str(input.couponCode, "", 60) || null } : {}),
      ...(override !== undefined ? { commission_override: override ? JSON.stringify(override) : null } : {}),
      ...(input.payoutMethod !== undefined ? { payout_method: method } : {}),
      ...(input.payoutDetails !== undefined ? { payout_details: JSON.stringify(normalizePayoutDetails(method, input.payoutDetails)) } : {}),
      ...(input.website !== undefined ? { website: str(input.website, "", 255) || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ? input.notes.slice(0, 5000) : null } : {}),
      ...(input.lastVisitorHash !== undefined ? { last_visitor_hash: input.lastVisitorHash } : {}),
      updated_at: now(),
    })
    .where("id", "=", affiliate.id)
    .execute();
}

/** Set a new portal password and sign out every portal session of the affiliate. */
export async function setAffiliatePassword(affiliateId: number, password: string): Promise<void> {
  const db = await getDb();
  await db.updateTable("affiliates").set({ password_hash: await hashPassword(password), updated_at: now() }).where("id", "=", affiliateId).execute();
  await db.deleteFrom("affiliate_sessions").where("affiliate_id", "=", affiliateId).execute();
  await db.deleteFrom("affiliate_password_resets").where("affiliate_id", "=", affiliateId).execute();
}

// A real scrypt hash of a random password: failed lookups take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;

/** Portal sign-in check. Returns the affiliate (any status: the caller decides) or null. */
export async function verifyAffiliateLogin(programId: number, email: string, password: string): Promise<AffiliateRecord | null> {
  const clean = normalizeEmail(email);
  const db = await getDb();
  const row = clean ? await db.selectFrom("affiliates").selectAll().where("program_id", "=", programId).where("email", "=", clean).executeTakeFirst() : undefined;
  if (!row?.password_hash) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  await db.updateTable("affiliates").set({ last_login_at: now() }).where("id", "=", row.id).execute();
  return toAffiliateRecord(row);
}

/** Delete an affiliate with their clicks, leads, unpaid commissions and portal sessions. Paid history is kept. */
export async function deleteAffiliate(affiliateId: number): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("affiliate_sessions").where("affiliate_id", "=", affiliateId).execute();
    await trx.deleteFrom("affiliate_password_resets").where("affiliate_id", "=", affiliateId).execute();
    await trx.deleteFrom("clicks").where("affiliate_id", "=", affiliateId).execute();
    await trx.deleteFrom("click_daily").where("affiliate_id", "=", affiliateId).execute();
    await trx.deleteFrom("referrals").where("affiliate_id", "=", affiliateId).execute();
    await trx.deleteFrom("conversions").where("affiliate_id", "=", affiliateId).where("status", "!=", "paid").execute();
    await trx.deleteFrom("payouts").where("affiliate_id", "=", affiliateId).where("status", "=", "draft").execute();
    const paid = await trx.selectFrom("payouts").select("id").where("affiliate_id", "=", affiliateId).executeTakeFirst();
    if (paid) {
      // Keep the row (anonymised and blocked) so paid payouts and conversions stay consistent.
      await trx
        .updateTable("affiliates")
        .set({ status: "blocked", email: `deleted-${affiliateId}@invalid`, name: "Deleted affiliate", password_hash: null, payout_details: "{}", notes: null, updated_at: now() })
        .where("id", "=", affiliateId)
        .execute();
    } else {
      await trx.deleteFrom("conversions").where("affiliate_id", "=", affiliateId).execute();
      await trx.deleteFrom("affiliates").where("id", "=", affiliateId).execute();
    }
  });
}
