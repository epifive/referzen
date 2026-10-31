import "server-only";
import { DEMO_MESSAGE } from "./admin";
import { getCurrentUser, requireUser, type SessionUser } from "./auth/session";
import { isDemoMode } from "./config";
import { getEntitlements, type Entitlements } from "./plans";

/** For dashboard pages: the signed-in user (redirects to the login page otherwise). */
export async function requireDashboardUser(): Promise<SessionUser> {
  return requireUser("/dashboard");
}

/**
 * Guard for dashboard Server Actions. Returns the signed-in, active user, or an
 * error message. In demo mode changes are blocked so every visitor sees the same data.
 */
export async function guardDashboard(options: { allowInDemo?: boolean } = {}): Promise<
  { ok: true; user: SessionUser; entitlements: Entitlements } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Your session has expired. Sign in again." };
  if (isDemoMode() && !options.allowInDemo) return { ok: false, error: DEMO_MESSAGE };
  return { ok: true, user, entitlements: await getEntitlements(user) };
}
