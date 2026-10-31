/**
 * CSV exports for payouts. Dependency-free (unit-testable).
 */

import { currencyDecimals, fromMinorUnits } from "./normalize";
import type { PayoutDetails } from "./types";

/** One payout line as the exports need it. */
export interface PayoutCsvRow {
  payoutId: number;
  affiliateName: string;
  affiliateEmail: string;
  method: string;
  details: PayoutDetails;
  /** Net amount to pay (commissions plus adjustmentCents). */
  amountCents: number;
  /** Adjustments deducted from this payout (0 or negative), e.g. commissions reversed after an earlier payout. */
  adjustmentCents?: number;
  currency: string;
  conversionCount: number;
  reference?: string | null;
  status?: string;
}

/** Quote a CSV cell when needed; neutralises spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Negative numbers ("-10.00", adjustments) are plain values, not formulas.
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 1999 USD → "19.99"; 500 JPY → "500" (dot decimal separator, no grouping). */
export function csvAmount(cents: number, currency: string): string {
  return fromMinorUnits(cents, currency).toFixed(currencyDecimals(currency));
}

/**
 * PayPal Payouts / Mass Payment CSV (upload in PayPal → Pay & Get Paid → Payouts). One line per
 * payout, no header row, five columns:
 *   recipient email, amount, currency, unique id (≤ 30 chars), note to recipient
 * Payouts without a PayPal email are skipped (they are returned in `skipped`).
 */
export function buildPayPalPayoutsCsv(rows: PayoutCsvRow[], options: { note?: string; idPrefix?: string } = {}): { csv: string; skipped: PayoutCsvRow[] } {
  const note = (options.note ?? "Affiliate commission").slice(0, 4000);
  const prefix = (options.idPrefix ?? "rz").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10);
  const lines: unknown[][] = [];
  const skipped: PayoutCsvRow[] = [];
  for (const row of rows) {
    const email = row.details.paypalEmail;
    if (row.method !== "paypal" || !email || row.amountCents <= 0) {
      skipped.push(row);
      continue;
    }
    lines.push([email, csvAmount(row.amountCents, row.currency), row.currency.toUpperCase(), `${prefix}-${row.payoutId}`.slice(0, 30), note]);
  }
  return { csv: lines.length ? toCsv(lines) : "", skipped };
}

/** Generic CSV with a header row: every payout with its method and details (for spreadsheets / accounting). */
export function buildPayoutsCsv(rows: PayoutCsvRow[]): string {
  const header = ["Payout ID", "Affiliate", "Email", "Method", "PayPal email", "Account name", "Account number / IBAN", "Bank code / BIC", "Bank name", "Country", "Payout note", "Amount", "Currency", "Conversions", "Adjustments", "Status", "Reference"];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.payoutId,
      r.affiliateName,
      r.affiliateEmail,
      r.method,
      r.details.paypalEmail ?? "",
      r.details.accountName ?? "",
      r.details.accountNumber ?? "",
      r.details.bankCode ?? "",
      r.details.bankName ?? "",
      r.details.country ?? "",
      r.details.note ?? "",
      csvAmount(r.amountCents, r.currency),
      r.currency,
      r.conversionCount,
      csvAmount(r.adjustmentCents ?? 0, r.currency),
      r.status ?? "",
      r.reference ?? "",
    ]),
  ]);
}

/** Bank transfer CSV (bank payouts only): name, account, bank code, bank, country, amount, currency, reference. */
export function buildBankCsv(rows: PayoutCsvRow[], options: { reference?: string } = {}): string {
  const header = ["Account name", "Account number / IBAN", "Bank code / BIC", "Bank name", "Country", "Amount", "Currency", "Reference", "Email"];
  return toCsv([
    header,
    ...rows
      .filter((r) => r.method === "bank" && r.amountCents > 0)
      .map((r) => [
        r.details.accountName || r.affiliateName,
        r.details.accountNumber ?? "",
        r.details.bankCode ?? "",
        r.details.bankName ?? "",
        r.details.country ?? "",
        csvAmount(r.amountCents, r.currency),
        r.currency,
        `${options.reference ?? "Commission"} ${r.payoutId}`.slice(0, 35),
        r.affiliateEmail,
      ]),
  ]);
}
