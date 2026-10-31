import "server-only";
import { apiError } from "./api-guard";
import type { AffiliateRecord } from "./affiliates";
import type { ConversionRecord } from "./conversions";
import { getOwnedProgram, getProgramAvailability, portalPath, unavailableMessage, type ProgramRecord } from "./programs";
import { BodyTooLargeError, isRecord, parseJsonText, readBodyText } from "./public-api";
import { fromMinorUnits } from "@/referral/normalize";
import type { ApiAffiliate, ApiConversion, ApiProgram } from "@/referral/types";

/** Shared helpers of the REST API (/api/v1, Authorization: Bearer <API key>). */

export const MAX_API_BODY = 16 * 1024;

/** The JSON object body of a request, or an error response. */
export async function readApiJson(request: Request): Promise<Record<string, unknown> | Response> {
  let text: string;
  try {
    text = await readBodyText(request, MAX_API_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return apiError(413, "Request body too large (max 16 KB).");
    return apiError(400, "Could not read the request body.");
  }
  const body = parseJsonText(text);
  if (!isRecord(body)) return apiError(400, "Send a JSON object (Content-Type: application/json).");
  return body;
}

/**
 * program_id from a body / query value, checked against the API key's account. With
 * `write`, paused programs are refused (403): nothing is recorded for them.
 */
export async function apiProgram(value: unknown, userId: number, options: { write?: boolean } = {}): Promise<ProgramRecord | Response> {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(id) || id < 1) return apiError(400, "program_id is required (the id of one of your programs).");
  const program = await getOwnedProgram(id, userId);
  if (!program) return apiError(404, "Program not found.");
  if (options.write) {
    const availability = await getProgramAvailability(program);
    if (availability !== "active") return apiError(403, unavailableMessage(availability));
  }
  return program;
}

/** A conversion for the API; `programCurrency` is the currency of the commission. */
export function toApiConversion(c: ConversionRecord, affiliateCode: string, programCurrency: string): ApiConversion & Record<string, unknown> {
  return {
    id: c.id,
    program_id: c.programId,
    affiliate_id: c.affiliateId,
    affiliate_code: affiliateCode,
    source: c.source,
    order_id: c.externalId,
    amount: fromMinorUnits(c.amountCents, c.currency),
    commission: fromMinorUnits(c.commissionCents, programCurrency),
    ...(c.currency !== programCurrency ? { commission_currency: programCurrency } : {}),
    currency: c.currency,
    status: c.status,
    occurred_at: c.occurredAt,
    customer_id: c.customerRef,
    subscription_id: c.subscriptionRef,
    payment_number: c.nth,
    flags: c.flags,
    reversal_reason: c.reversalReason,
  };
}

/** A program for the API; `origin` is the platform's base URL (portal links). */
export function toApiProgram(p: ProgramRecord, origin: string): ApiProgram {
  return { id: p.id, name: p.name, slug: p.slug, currency: p.currency, status: p.status, portal_url: `${origin.replace(/\/+$/, "")}${portalPath(p.slug)}` };
}

export function toApiAffiliate(a: AffiliateRecord): ApiAffiliate {
  return { id: a.id, program_id: a.programId, name: a.name, email: a.email, code: a.code, status: a.status, created_at: a.createdAt };
}

/** limit / offset query parameters (default 50, max 500). */
export function pageParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
  return { limit, offset };
}
