"use server";

import { guardAdmin } from "@/lib/admin";
import { getProgram, updateProgram } from "@/lib/programs";
import type { FormState } from "@/app/actions/types";

/**
 * Pause or resume a customer's referral program. A paused program records no clicks,
 * referrals or conversions and its portal accepts no sign-ups (the owner can resume it in the
 * program settings; ban the owner to stop it for good).
 */
export async function setProgramStatusAdmin(programId: number, status: "active" | "paused"): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const program = await getProgram(Number(programId));
  if (!program) return { error: "Program not found." };
  await updateProgram(program, { status: status === "paused" ? "paused" : "active" });
  return { success: status === "paused" ? "Program paused." : "Program resumed." };
}
