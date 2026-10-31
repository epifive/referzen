import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { getProgramsPeriodTotals, periodRange } from "@/lib/merchant-stats";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/referral/normalize";
import { ProgramStatusButton } from "./program-actions";

export const metadata = { title: "Programs" };

const PER_PAGE = 25;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "unverified", label: "Not installed" },
] as const;

export default async function AdminProgramsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter! : "all";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const db = await getDb();
  // The same 30 UTC days as the owner's dashboard, so both show the same numbers.
  const range = periodRange(30);

  let query = db.selectFrom("programs").innerJoin("users", "users.id", "programs.user_id");
  if (q) {
    query = query.where((eb) =>
      eb.or([eb("programs.name", "like", `%${q}%`), eb("programs.slug", "like", `%${q}%`), eb("programs.domain", "like", `%${q}%`), eb("users.email", "like", `%${q}%`)]),
    );
  }
  if (filter === "active") query = query.where("programs.status", "=", "active");
  if (filter === "paused") query = query.where("programs.status", "=", "paused");
  if (filter === "unverified") query = query.where("programs.verified_at", "is", null);

  const [total, rows] = await Promise.all([
    query.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    query
      .select([
        "programs.id",
        "programs.name",
        "programs.slug",
        "programs.domain",
        "programs.currency",
        "programs.status",
        "programs.verified_at",
        "programs.created_at",
        "users.id as owner_id",
        "users.email as owner_email",
        "users.name as owner_name",
        "users.status as owner_status",
      ])
      .orderBy("programs.id", "desc")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .execute(),
  ]);
  const ids = rows.map((r) => r.id);
  const [affiliates, conversions] = ids.length
    ? await Promise.all([
        db
          .selectFrom("affiliates")
          .select((eb) => ["program_id", "status", eb.fn.countAll<number>().as("n")])
          .where("program_id", "in", ids)
          .groupBy(["program_id", "status"])
          .execute(),
        getProgramsPeriodTotals(ids, range),
      ])
    : [[], new Map<number, { n: number; revenue: number; commission: number }>()];
  const affBy = new Map<number, { total: number; approved: number; pending: number }>();
  for (const a of affiliates) {
    const cur = affBy.get(a.program_id) ?? { total: 0, approved: 0, pending: 0 };
    const n = Number(a.n ?? 0);
    cur.total += n;
    if (a.status === "approved") cur.approved += n;
    if (a.status === "pending") cur.pending += n;
    affBy.set(a.program_id, cur);
  }
  const convBy = conversions;
  const count = Number(total?.n ?? 0);
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const href = (p: number, f = filter) => `/admin/programs?${new URLSearchParams({ ...(q ? { q } : {}), filter: f, page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Programs"
        description={`${count.toLocaleString()} referral programs created by your customers. Revenue and conversions cover the last 30 days (UTC, today included), like the owners' dashboards. Paused programs record no clicks, referrals or conversions.`}
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <form className="relative w-full sm:max-w-xs" action="/admin/programs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="hidden" name="filter" value={filter} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search program, domain or owner"
              aria-label="Search programs"
              className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
            />
          </form>
          <nav aria-label="Filter" className="flex flex-wrap gap-1.5 text-sm">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={href(1, f.value)}
                aria-current={f.value === filter ? "true" : undefined}
                className={f.value === filter ? "rounded-full bg-primary px-3 py-1 font-medium text-white" : "rounded-full bg-paper px-3 py-1 font-medium text-muted hover:text-ink"}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        {rows.length ? (
          <Table minWidth={980}>
            <thead>
              <tr>
                <Th>Program</Th>
                <Th>Owner</Th>
                <Th className="text-right">Affiliates</Th>
                <Th className="text-right">Conversions, 30 d</Th>
                <Th className="text-right">Revenue, 30 d</Th>
                <Th>Tracking</Th>
                <Th>Created</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const aff = affBy.get(r.id) ?? { total: 0, approved: 0, pending: 0 };
                const conv = convBy.get(r.id) ?? { n: 0, revenue: 0, commission: 0 };
                return (
                  <tr key={r.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.status === "paused" ? <Badge tone="warning">Paused</Badge> : null}
                        {r.owner_status !== "active" ? <Badge tone="danger">Owner banned</Badge> : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        <span>{r.domain}</span>
                        <Link href={`/a/${r.slug}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                          /a/{r.slug}
                          <ExternalLink className="size-3" aria-hidden />
                        </Link>
                      </div>
                    </Td>
                    <Td>
                      <Link href={`/admin/users/${r.owner_id}`} className="hover:text-primary hover:underline">
                        {r.owner_email}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {aff.approved.toLocaleString()}
                      {aff.pending ? <span className="block text-xs text-muted">+{aff.pending.toLocaleString()} pending</span> : null}
                    </Td>
                    <Td className="text-right tabular-nums">{conv.n.toLocaleString()}</Td>
                    <Td className="text-right tabular-nums">
                      {formatMoney(conv.revenue, r.currency, "en-US")}
                      {conv.commission ? <span className="block text-xs text-muted">{formatMoney(conv.commission, r.currency, "en-US")} commission</span> : null}
                    </Td>
                    <Td>{r.verified_at ? <Badge tone="success">Verified</Badge> : <Badge>Not installed</Badge>}</Td>
                    <Td className="text-muted">{formatDate(r.created_at)}</Td>
                    <Td className="text-right">
                      <ProgramStatusButton id={r.id} name={r.name} status={r.status === "paused" ? "paused" : "active"} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={q || filter !== "all" ? "No programs match." : "No programs yet."}>
            {q || filter !== "all" ? "Try another search or filter." : "Programs appear here once customers create them in their dashboard."}
          </EmptyState>
        )}
        <Pagination page={page} pages={pages} href={(p) => href(p)} />
      </Card>
    </>
  );
}
