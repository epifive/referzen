import "server-only";
import { isDemoMode } from "@/lib/config";
import type { AffiliateRecord } from "@/lib/affiliates";
import { getT } from "@/lib/i18n/server";
import { getPortalAffiliate, getPortalProgram } from "@/lib/portal-session";
import type { ProgramRecord } from "@/lib/programs";

/** Shared helpers for the affiliate portal Server Actions (not an action module itself). */

export const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

/** Program of the portal form (hidden input "slug"). */
export async function programFromForm(formData: FormData): Promise<ProgramRecord | undefined> {
  const slug = field(formData, "slug").trim().toLowerCase();
  return slug ? getPortalProgram(slug) : undefined;
}

/**
 * Guard for signed-in portal actions: the program of the form and the affiliate signed in to
 * that program's portal (any other program's session is ignored). Pending affiliates may edit
 * their profile and payout details; blocked ones have no session.
 */
export async function guardPortal(formData: FormData, options: { allowInDemo?: boolean } = {}): Promise<
  { ok: true; program: ProgramRecord; affiliate: AffiliateRecord } | { ok: false; error: string }
> {
  const t = await getT();
  const program = await programFromForm(formData);
  if (!program) return { ok: false, error: t("portal.err.notFound") };
  const affiliate = await getPortalAffiliate(program.id);
  if (!affiliate) return { ok: false, error: t("portal.err.session") };
  if (isDemoMode() && !options.allowInDemo) return { ok: false, error: t("portal.err.demo") };
  return { ok: true, program, affiliate };
}
