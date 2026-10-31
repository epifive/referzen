import "server-only";
import { getDb, now } from "./db";
import type { Plan } from "./db/schema";
import type { SessionUser } from "./auth/session";

export interface Entitlements {
  plan: Plan | null;
  /** True when the user has an active paid plan. */
  isPremium: boolean;
  /** Limits; 0 means unlimited. */
  maxPrograms: number;
  /** Affiliates across all of the user's programs. */
  maxAffiliates: number;
  /** Conversions recorded per calendar month (all programs). */
  maxMonthlyConversions: number;
  /** REST API access (/api/v1). */
  allowApi: boolean;
  /** Hide the "Powered by" line in affiliate portals and emails. */
  removeBranding: boolean;
  expiresAt: string | null;
}

/** Limits used if no plan is marked as the free plan (the same as the default free plan). */
const FALLBACK_FREE = { maxPrograms: 1, maxAffiliates: 25, maxMonthlyConversions: 50, allowApi: false, removeBranding: false };

export async function getActivePlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_active", "=", 1).orderBy("sort_order").orderBy("id").execute();
}

export async function getAllPlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().orderBy("sort_order").orderBy("id").execute();
}

export async function getPlan(id: number): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getFreePlan(): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_free", "=", 1).orderBy("id").executeTakeFirst();
}

export function hasActivePaidPlan(user: Pick<SessionUser, "plan_id" | "plan_expires_at"> | null): boolean {
  return Boolean(user?.plan_id && user.plan_expires_at && user.plan_expires_at > now());
}

type Limits = Pick<Entitlements, "maxPrograms" | "maxAffiliates" | "maxMonthlyConversions" | "allowApi" | "removeBranding">;

function fromPlan(plan: Plan): Limits {
  return {
    maxPrograms: plan.max_programs,
    maxAffiliates: plan.max_affiliates,
    maxMonthlyConversions: plan.max_monthly_conversions,
    allowApi: plan.allow_api === 1,
    removeBranding: plan.remove_branding === 1,
  };
}

export async function getEntitlements(user: Pick<SessionUser, "role" | "plan_id" | "plan_expires_at"> | null): Promise<Entitlements> {
  // Administrators run the platform, so their own programs are never limited.
  if (user?.role === "admin") {
    return { plan: null, isPremium: true, maxPrograms: 0, maxAffiliates: 0, maxMonthlyConversions: 0, allowApi: true, removeBranding: true, expiresAt: null };
  }
  if (user && hasActivePaidPlan(user)) {
    const plan = await getPlan(user.plan_id!);
    if (plan && !plan.is_free) return { plan, isPremium: true, ...fromPlan(plan), expiresAt: user.plan_expires_at };
  }
  const free = await getFreePlan();
  return {
    plan: free ?? null,
    isPremium: false,
    ...(free ? fromPlan(free) : FALLBACK_FREE),
    expiresAt: null,
  };
}

/** True when `used` has reached a limit (0 = unlimited). */
export function atLimit(used: number, limit: number): boolean {
  return limit > 0 && used >= limit;
}

export function planFeatures(plan: Pick<Plan, "features">): string[] {
  return (plan.features ?? "")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Entitlements of a user by id (e.g. the owner of a program in webhooks and jobs). */
export async function getEntitlementsForUserId(userId: number): Promise<Entitlements> {
  const db = await getDb();
  const user = await db.selectFrom("users").select(["role", "plan_id", "plan_expires_at"]).where("id", "=", userId).executeTakeFirst();
  return getEntitlements(user ?? null);
}
