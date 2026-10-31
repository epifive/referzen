import type { AlertEvent, AlertPayload } from "@/referral/types";

/**
 * Turns an AlertPayload into the title, summary and fields every channel shows.
 * Alerts are written in English (like the webhook payload), whatever the dashboard language.
 */

/** "2026-10-16 14:05 UTC" */
export function humanTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function humanNumber(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export const EVENT_COLORS: Record<AlertEvent, string> = {
  new_affiliate: "#7c3aed",
  new_conversion: "#16a34a",
  conversion_reversed: "#dc2626",
  payout_paid: "#be185d",
  quota_warning: "#d97706",
  quota_reached: "#dc2626",
  test: "#1d5bd8",
};

const SUBJECT_PREFIX: Record<AlertEvent, string> = {
  new_affiliate: "New affiliate",
  new_conversion: "New conversion",
  conversion_reversed: "Conversion reversed",
  payout_paid: "Payout paid",
  quota_warning: "Usage 80%",
  quota_reached: "Usage limit reached",
  test: "Test",
};

/** True for events that need attention (red / "Attention" styling). */
export function isProblem(event: AlertEvent): boolean {
  return event === "conversion_reversed" || event === "quota_reached";
}

export interface AlertText {
  /** One-line headline, e.g. "New conversion in Northwind SaaS". */
  title: string;
  /** Email subject, e.g. "[New conversion] Northwind SaaS". */
  subject: string;
  /** One or two sentences with the essentials. */
  summary: string;
  /** Label/value pairs shown as fields. */
  facts: Array<[string, string]>;
  color: string;
  /** Label of the link button ("Open dashboard"). */
  linkLabel: string;
}

/** Fact labels for well-known `data` keys (other keys are shown as they are). */
const FACT_LABELS: Record<string, string> = {
  affiliate: "Affiliate",
  email: "Email",
  code: "Referral code",
  status: "Status",
  amount: "Order amount",
  commission: "Commission",
  order: "Order",
  source: "Source",
  reason: "Reason",
  payouts: "Payouts",
  total: "Total",
  reference: "Reference",
  used: "Used this month",
  limit: "Monthly limit",
};

export function describeAlert(p: AlertPayload, siteName: string): AlertText {
  const program = p.program?.name || "your program";
  const facts: Array<[string, string]> = [];
  if (p.program) facts.push(["Program", p.program.name]);
  for (const [key, value] of Object.entries(p.data)) {
    if (key === "example") continue;
    facts.push([FACT_LABELS[key] ?? key, typeof value === "number" ? humanNumber(value) : String(value)]);
  }
  let title: string;
  switch (p.event) {
    case "new_affiliate":
      title = `New affiliate in ${program}`;
      break;
    case "new_conversion":
      title = `New conversion in ${program}`;
      break;
    case "conversion_reversed":
      title = `Conversion reversed in ${program}`;
      break;
    case "payout_paid":
      title = `Payout paid in ${program}`;
      break;
    case "quota_warning":
      title = "You have used 80% of your monthly conversions";
      break;
    case "quota_reached":
      title = "You have reached your monthly conversion limit";
      break;
    case "test":
      title = `Test alert from ${siteName}`;
      break;
  }
  return {
    title,
    subject: `[${SUBJECT_PREFIX[p.event]}] ${p.event === "test" || !p.program ? siteName : p.program.name}`,
    summary: p.message,
    facts,
    color: EVENT_COLORS[p.event],
    linkLabel: "Open dashboard",
  };
}

/** Plain-text body used by email (and as a fallback elsewhere). */
export function alertPlainText(p: AlertPayload, siteName: string): string {
  const t = describeAlert(p, siteName);
  return [t.title, "", t.summary, "", ...t.facts.map(([k, v]) => `${k}: ${v}`), "", `${t.linkLabel}: ${p.url}`, "", `— ${siteName}`].join("\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface SendContext {
  siteName: string;
  /** Webhooks may point at private/internal addresses (env ALLOW_PRIVATE_WEBHOOKS=1). */
  allowPrivate: boolean;
  timeoutMs: number;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}
