import "server-only";
import { notFound } from "next/navigation";
import type { SessionUser } from "./auth/session";
import { requireDashboardUser } from "./dashboard";
import { getOwnedProgram, type ProgramRecord } from "./programs";

/**
 * For merchant dashboard pages under /dashboard/programs/[id]: the signed-in user and their
 * program, or a 404 when the id is invalid or the program belongs to another account.
 */
export async function requireProgram(idParam: string): Promise<{ user: SessionUser; program: ProgramRecord }> {
  const user = await requireDashboardUser();
  const id = Number(idParam);
  const program = Number.isInteger(id) && id > 0 ? await getOwnedProgram(id, user.id) : undefined;
  if (!program) notFound();
  return { user, program };
}

/** Path of a program page in the merchant dashboard. */
export function programPath(programId: number, page = ""): string {
  return `/dashboard/programs/${programId}${page ? `/${page.replace(/^\/+/, "")}` : ""}`;
}
