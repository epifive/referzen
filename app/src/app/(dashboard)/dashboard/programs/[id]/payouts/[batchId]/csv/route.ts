import { getCurrentUser } from "@/lib/auth/session";
import { buildBankCsv, buildPayPalPayoutsCsv, buildPayoutsCsv, getBatchCsvRows, getOwnedBatch } from "@/lib/payouts";
import { getOwnedProgram } from "@/lib/programs";

export const dynamic = "force-dynamic";

/**
 * Payout batch exports: ?format=paypal (PayPal Payouts upload, no header), bank (bank transfer
 * list) or generic (every payout with its details). Only the owner of the program can download.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Unauthorized", { status: 401 });
  const { id, batchId } = await params;
  const program = await getOwnedProgram(Number(id), user.id);
  const batch = program ? await getOwnedBatch(program.id, Number(batchId)) : undefined;
  if (!program || !batch) return new Response("Not found", { status: 404 });

  const format = new URL(request.url).searchParams.get("format") ?? "generic";
  const rows = await getBatchCsvRows(batch.id);
  let csv: string;
  let suffix: string;
  if (format === "paypal") {
    csv = buildPayPalPayoutsCsv(rows, { note: `${program.name}: affiliate commission`, idPrefix: `rz${batch.id}` }).csv;
    suffix = "paypal-payouts";
  } else if (format === "bank") {
    csv = buildBankCsv(rows, { reference: `${program.name} commission` });
    suffix = "bank-transfers";
  } else {
    csv = buildPayoutsCsv(rows);
    suffix = "payouts";
  }
  const name = `${program.slug}-batch-${batch.id}-${suffix}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
