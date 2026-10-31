import { getCurrentUser } from "@/lib/auth/session";
import { conversionFiltersFrom } from "@/lib/merchant-filters";
import { listConversions } from "@/lib/merchant-stats";
import { getOwnedProgram } from "@/lib/programs";
import { csvAmount, toCsv } from "@/referral/csv";

export const dynamic = "force-dynamic";

/** CSV export of a program's conversions with the filters of the conversions page (max 10,000 rows). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const program = await getOwnedProgram(Number(id), user.id);
  if (!program) return new Response("Not found", { status: 404 });
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const { filters } = conversionFiltersFrom(query);
  const { rows } = await listConversions(program.id, filters, { limit: 10_000 });
  const csv = toCsv([
    ["ID", "Date (UTC)", "Affiliate", "Affiliate email", "Referral code", "Source", "Order ID", "Customer", "Payment #", "Amount", "Currency", "Commission", "Commission currency", "Status", "Flags", "Approved at", "Paid at", "Reversed at", "Reversal reason", "Note"],
    ...rows.map((c) => [
      c.id,
      c.occurredAt,
      c.affiliateName,
      c.affiliateEmail,
      c.affiliateCode,
      c.source,
      c.externalId,
      c.customerRef ?? "",
      c.nth,
      csvAmount(c.amountCents, c.currency),
      c.currency,
      csvAmount(c.commissionCents, program.currency),
      program.currency,
      c.status,
      c.flags.join(" "),
      c.approvedAt ?? "",
      c.paidAt ?? "",
      c.reversedAt ?? "",
      c.reversalReason ?? "",
      c.note ?? "",
    ]),
  ]);
  const name = `${program.slug}-conversions-${new Date().toISOString().slice(0, 10)}.csv`;
  // UTF-8 byte order mark so Excel opens accented names correctly.
  return new Response(`${String.fromCharCode(0xfeff)}${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
