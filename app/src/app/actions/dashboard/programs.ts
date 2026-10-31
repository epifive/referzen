"use server";

import { redirect } from "next/navigation";
import { saveUpload } from "@/lib/admin";
import { ownedChannelIds } from "@/lib/channels";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { plural, type Translator } from "@/lib/i18n/messages";
import { programPath } from "@/lib/merchant-program";
import { atLimit } from "@/lib/plans";
import {
  countUserPrograms,
  createProgram,
  deleteProgram,
  getOwnedProgram,
  getProgramByWebhookToken,
  isSlugTaken,
  MAX_WEBHOOK_SECRETS,
  parseWebhookSecrets,
  WEBHOOK_SECRET_FIELD_MAX,
  regeneratePublicKey,
  regenerateWebhookToken,
  setWebhookSecret,
  updateProgram,
  webhookPath,
  type ProgramRecord,
} from "@/lib/programs";
import { rateLimit } from "@/lib/rate-limit";
import { baseUrl } from "@/lib/request";
import { latestReferralToken } from "@/lib/merchant-stats";
import { WEBHOOK_SAMPLES, withSampleReferral, type WebhookSample } from "@/lib/webhooks/samples";
import { handleWebhook } from "@/lib/webhooks/receive";
import { base64Signature, hexSignature, stripeSignatureHeader } from "@/lib/webhooks/verify";
import {
  isReservedSlug,
  normalizeColor,
  normalizeCurrency,
  normalizeDomain,
  normalizeParamName,
  normalizeSlug,
  str as clean,
  text,
} from "@/referral/normalize";
import {
  COMMISSION_TYPES,
  LEAD_EMAIL_MODES,
  NOTIFY_EVENTS,
  PAYOUT_METHODS,
  RECURRING_MODES,
  type CommissionType,
  type NotifyEvent,
  type PayoutMethod,
  type ProgramSettings,
  type RecurringMode,
} from "@/referral/types";
import type { FormState } from "../types";
import { decimalOf, idOf, intOf, moneyOf, str } from "./helpers";

type Guarded = { ok: true; userId: number; program: ProgramRecord; t: Translator } | { ok: false; error: string };

/** Guard + ownership of the program_id field. */
async function ownedProgram(formData: FormData, options: { allowInDemo?: boolean } = {}): Promise<Guarded> {
  const guard = await guardDashboard(options);
  if (!guard.ok) return guard;
  const t = await getT();
  const program = await getOwnedProgram(idOf(formData.get("program_id")), guard.user.id);
  if (!program) return { ok: false, error: t("dash.merr.programNotFound") };
  return { ok: true, userId: guard.user.id, program, t };
}

const oneOf = <T extends string>(values: readonly T[], v: string): T | undefined => ((values as readonly string[]).includes(v) ? (v as T) : undefined);

/** Commission type + rate from the form ("25" % → 2500 bp; "10.00" fixed → minor units). */
function commissionFromForm(formData: FormData, currency: string, t: Translator): { type: CommissionType; rate: number } | { error: string } {
  const type = oneOf(COMMISSION_TYPES, str(formData.get("commissionType"))) ?? "percent";
  if (type === "percent") {
    const pct = decimalOf(formData.get("rate"));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: t("dash.merr.ratePercent") };
    return { type, rate: Math.round(pct * 100) };
  }
  const cents = moneyOf(formData.get("rate"), currency);
  if (cents <= 0) return { error: t("dash.merr.rateFixed") };
  return { type, rate: cents };
}

export async function createProgramAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (atLimit(await countUserPrograms(guard.user.id), guard.entitlements.maxPrograms)) {
    return { error: plural(t, "dash.merr.programLimit", guard.entitlements.maxPrograms) };
  }
  const domain = normalizeDomain(str(formData.get("domain")));
  if (!domain) return { error: t("dash.merr.domain") };
  const name = clean(str(formData.get("name")), "", 120) || domain;
  // Default: the platform currency (Admin → Settings), applied by createProgram().
  const currency = normalizeCurrency(str(formData.get("currency")), "") || undefined;
  const commission = commissionFromForm(formData, currency ?? "USD", t);
  if ("error" in commission) return { error: commission.error };
  const mode = oneOf(RECURRING_MODES, str(formData.get("recurringMode"))) ?? "none";
  const months = intOf(formData.get("recurringMonths"), 1, 120);
  const program = await createProgram(guard.user.id, {
    name,
    domain,
    currency,
    settings: {
      commissionType: commission.type,
      rate: commission.rate,
      recurring: { mode, months: Number.isFinite(months) ? months : 12 },
    },
  });
  redirect(`${programPath(program.id, "integrations")}?created=1`);
}

export interface SlugCheck {
  slug: string;
  available: boolean;
}

/** Live availability of a portal slug while typing (settings page). */
export async function checkSlugAction(programId: number, raw: string): Promise<SlugCheck> {
  const guard = await guardDashboard({ allowInDemo: true });
  if (!guard.ok) return { slug: "", available: false };
  const program = await getOwnedProgram(Number(programId), guard.user.id);
  const slug = normalizeSlug(String(raw ?? ""));
  if (!program || !slug || isReservedSlug(slug)) return { slug, available: false };
  if (slug === program.slug) return { slug, available: true };
  return { slug, available: !(await isSlugTaken(slug, program.id)) };
}

type Section = "general" | "commission" | "payouts" | "portal" | "tracking" | "notifications";

/** Saves one section of the program settings page (hidden "section" field). */
export async function saveProgramSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  const { program, t, userId } = owned;
  const section = str(formData.get("section")) as Section;
  const settings: Partial<ProgramSettings> = {};

  switch (section) {
    case "general": {
      const name = clean(str(formData.get("name")), "", 120);
      if (!name) return { error: t("dash.merr.name") };
      const domain = normalizeDomain(str(formData.get("domain")));
      if (!domain) return { error: t("dash.merr.domain") };
      const slug = normalizeSlug(str(formData.get("slug")));
      if (!slug) return { error: t("dash.merr.slug") };
      if (isReservedSlug(slug)) return { error: t("dash.merr.slugReserved") };
      if (slug !== program.slug && (await isSlugTaken(slug, program.id))) return { error: t("dash.merr.slugTaken") };
      const extraDomains = str(formData.get("extraDomains"))
        .split(/[\s,]+/)
        .filter(Boolean);
      const badDomain = extraDomains.find((d) => !normalizeDomain(d));
      if (badDomain) return { error: t("dash.merr.extraDomain", { domain: badDomain.slice(0, 60) }) };
      await updateProgram(program, {
        name,
        slug,
        domain,
        currency: normalizeCurrency(str(formData.get("currency")), program.currency),
        settings: { extraDomains: extraDomains.map(normalizeDomain).filter((d) => d !== domain) },
      });
      return { success: t("dash.pset.saved") };
    }
    case "commission": {
      const commission = commissionFromForm(formData, program.currency, t);
      if ("error" in commission) return { error: commission.error };
      const mode: RecurringMode = oneOf(RECURRING_MODES, str(formData.get("recurringMode"))) ?? "none";
      const months = intOf(formData.get("recurringMonths"), 1, 120);
      if (mode === "months" && !Number.isFinite(months)) return { error: t("dash.merr.months") };
      const cookieDays = intOf(formData.get("cookieDays"), 1, 365);
      if (!Number.isFinite(cookieDays)) return { error: t("dash.merr.cookieDays") };
      const holdDays = intOf(formData.get("holdDays"), 0, 365);
      if (!Number.isFinite(holdDays)) return { error: t("dash.merr.holdDays") };
      Object.assign(settings, {
        commissionType: commission.type,
        rate: commission.rate,
        recurring: { mode, months: Number.isFinite(months) ? months : program.settings.recurring.months },
        cookieDays,
        holdDays,
      });
      break;
    }
    case "payouts": {
      let minPayoutCents = 0;
      if (str(formData.get("minPayout")).trim()) {
        const n = decimalOf(formData.get("minPayout"));
        if (!Number.isFinite(n) || n < 0) return { error: t("dash.merr.minPayout") };
        minPayoutCents = n > 0 ? moneyOf(formData.get("minPayout"), program.currency) : 0;
      }
      const methods = formData.getAll("payoutMethods").map(String).filter((m): m is PayoutMethod => (PAYOUT_METHODS as readonly string[]).includes(m));
      if (!methods.length) return { error: t("dash.merr.payoutMethods") };
      Object.assign(settings, { minPayoutCents, payoutMethods: methods, autoApprove: formData.get("autoApprove") === "on" });
      break;
    }
    case "portal": {
      let logo = program.settings.logo;
      const file = formData.get("logo_file");
      if (formData.get("remove_logo") === "1") logo = "";
      else if (file instanceof File && file.size > 0) {
        try {
          logo = await saveUpload(file, `program-${program.id}-logo`);
        } catch (error) {
          return { error: error instanceof Error ? error.message : t("dash.merr.upload") };
        }
      } else {
        const url = str(formData.get("logo_url")).trim();
        if (url && url !== logo) {
          if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return { error: t("dash.merr.logoUrl") };
          logo = url;
        }
      }
      const color = str(formData.get("brandColor")).trim();
      if (color && !normalizeColor(color)) return { error: t("dash.merr.color") };
      Object.assign(settings, {
        portalHeadline: clean(str(formData.get("portalHeadline")), "", 120),
        portalIntro: text(str(formData.get("portalIntro")), 1000),
        brandColor: normalizeColor(color),
        logo,
        terms: text(str(formData.get("terms")), 20_000),
      });
      break;
    }
    case "tracking": {
      const params = str(formData.get("refParams"))
        .split(/[\s,]+/)
        .filter(Boolean);
      const bad = params.find((p) => !normalizeParamName(p));
      if (bad || !params.length) return { error: t("dash.merr.refParams") };
      Object.assign(settings, {
        refParams: params.map(normalizeParamName),
        leadEmailMode: oneOf(LEAD_EMAIL_MODES, str(formData.get("leadEmailMode"))) ?? "plain",
        allowClientConversions: formData.get("allowClientConversions") === "on",
        allowLocalhost: formData.get("allowLocalhost") === "on",
      });
      break;
    }
    case "notifications": {
      const wanted = formData
        .getAll("alertChannelIds")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      const events = formData.getAll("notifyEvents").map(String).filter((e): e is NotifyEvent => (NOTIFY_EVENTS as readonly string[]).includes(e));
      Object.assign(settings, {
        alertChannelIds: await ownedChannelIds(wanted, userId),
        notifyEvents: events,
        emailAffiliates: formData.get("emailAffiliates") === "on",
      });
      break;
    }
    default:
      return { error: t("dash.merr.generic") };
  }
  await updateProgram(program, { settings });
  return { success: t("dash.pset.saved") };
}

export async function setProgramStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  const status = str(formData.get("status")) === "paused" ? "paused" : "active";
  await updateProgram(owned.program, { status });
  return { success: status === "paused" ? owned.t("dash.pset.pausedDone") : owned.t("dash.pset.resumedDone") };
}

export async function deleteProgramAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  if (str(formData.get("confirm")).trim() !== owned.program.name.trim()) return { error: owned.t("dash.merr.confirmName") };
  await deleteProgram(owned.program.id);
  redirect("/dashboard?deleted=1");
}

export async function regenerateWebhookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  await regenerateWebhookToken(owned.program.id);
  return { success: owned.t("dash.int.regenerated") };
}

export async function regenerateKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  await regeneratePublicKey(owned.program.id);
  return { success: owned.t("dash.int.keyRegenerated") };
}

export async function saveWebhookSecretAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  if (formData.get("remove") === "1") {
    await setWebhookSecret(owned.program.id, null);
    return { success: owned.t("dash.int.secretRemoved") };
  }
  // One secret, or several separated by commas / new lines (one per Stripe endpoint, or the old
  // and the new one while rotating). Each: 8–200 printable characters without spaces or commas.
  const raw = str(formData.get("secret")).trim();
  const parts = raw.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.some((s) => !/^[!-+\--~]{8,200}$/.test(s))) return { error: owned.t("dash.merr.secret") };
  const secrets = parseWebhookSecrets(parts.join("\n"));
  const value = secrets.join("\n");
  if (parts.length > MAX_WEBHOOK_SECRETS || value.length > WEBHOOK_SECRET_FIELD_MAX) return { error: owned.t("dash.merr.secretTooMany", { n: MAX_WEBHOOK_SECRETS }) };
  await setWebhookSecret(owned.program.id, value);
  return { success: owned.t("dash.int.secretSaved") };
}

export interface TestEventState extends FormState {
  status?: number;
  body?: string;
}

/** Signature headers for a sample signed with the program's (first) signing secret, like the provider would send. */
function signatureHeaders(preset: WebhookSample["preset"], payload: string, secret: string | null): Record<string, string> {
  if (!secret) return {};
  switch (preset) {
    case "stripe":
      return { "Stripe-Signature": stripeSignatureHeader(payload, secret) };
    case "woocommerce":
      return { "X-WC-Webhook-Signature": base64Signature(payload, secret) };
    case "shopify":
      return { "X-Shopify-Hmac-Sha256": base64Signature(payload, secret) };
    default:
      return { "X-Referzen-Signature": `sha256=${hexSignature(payload, secret)}` };
  }
}

/** The answer of a test event, pretty-printed for the dashboard. */
async function testAnswer(res: Response, t: Translator, note?: string): Promise<TestEventState> {
  const answer = (await res.text()).slice(0, 2000);
  let pretty = answer;
  try {
    pretty = JSON.stringify(JSON.parse(answer), null, 2).slice(0, 2000);
  } catch {
    // Not JSON: show as is.
  }
  const prefix = note ? `${note} ` : "";
  return res.ok
    ? { success: `${prefix}${t("dash.int.testOk", { status: res.status })}`, status: res.status, body: pretty }
    : { error: `${prefix}${t("dash.int.testFailed", { status: res.status })}`, status: res.status, body: pretty };
}

/**
 * "Send test event": POST a sample payload to the program's own webhook URL and show the answer.
 * When the server can't reach its own public address (local install, firewall, wrong Site
 * URL), the same sample is handed to the webhook receiver directly, in this process.
 * With real=1 the sample carries the latest real referral token of the program, so it records a
 * real conversion (credited to that affiliate).
 */
export async function sendTestEventAction(_prev: TestEventState, formData: FormData): Promise<TestEventState> {
  const owned = await ownedProgram(formData);
  if (!owned.ok) return { error: owned.error };
  const { program, t, userId } = owned;
  const sample = WEBHOOK_SAMPLES.find((s) => s.id === str(formData.get("sample_id")));
  if (!sample) return { error: t("dash.merr.generic") };
  if (!rateLimit(`rz-test-event:${userId}`, 10, 60_000)) return { error: t("dash.channels.err.rate") };
  let body: unknown = sample.body;
  if (formData.get("real") === "1") {
    const token = await latestReferralToken(program.id);
    if (!token) return { error: t("dash.int.noReferral") };
    body = withSampleReferral(sample, token);
  }
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const secret = parseWebhookSecrets((await getProgramByWebhookToken(program.webhookToken))?.webhookSecret)[0] ?? null;
  const headers: Record<string, string> = { ...sample.headers, "Content-Type": sample.contentType, ...signatureHeaders(sample.preset, payload, secret) };
  if (!secret) {
    // The sample headers may carry placeholder signatures; without a secret nothing is verified.
    for (const k of Object.keys(headers)) if (/signature|hmac/i.test(k) && !/^content-type$/i.test(k)) delete headers[k];
  }
  const url = `${await baseUrl()}${webhookPath(program.webhookToken)}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body: payload, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return testAnswer(res, t);
  } catch (error) {
    // Unreachable public URL: process the sample here with the same receiver.
    try {
      const res = await handleWebhook(new Request(url, { method: "POST", headers, body: payload }), program.webhookToken);
      return testAnswer(res, t, t("dash.int.testLocal"));
    } catch {
      return { error: t("dash.int.testError", { error: error instanceof Error ? error.message : "fetch failed" }) };
    }
  }
}
