import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth/session";
import { countUserAffiliates } from "@/lib/affiliates";
import { getDb } from "@/lib/db";
import { getProgramsPeriodTotals, periodRange } from "@/lib/merchant-stats";
import { GATEWAY_LABELS } from "@/lib/payments";
import { getAllPlans, getEntitlements } from "@/lib/plans";
import { formatDate, formatMoney } from "@/lib/utils";
import { formatMoney as formatMoneyMinor } from "@/referral/normalize";
import { UserForm } from "../user-form";

export const metadata = { title: "Edit user" };

export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const user = await db.selectFrom("users").selectAll().where("id", "=", Number(id)).executeTakeFirst();
  if (!user) notFound();
  const month = new Date().toISOString().slice(0, 7);
  const [me, plans, payments, programCount, affiliateCount, usage, entitlements] = await Promise.all([
    getCurrentUser(),
    getAllPlans(),
    db.selectFrom("payments").selectAll().where("user_id", "=", user.id).orderBy("id", "desc").limit(20).execute(),
    db.selectFrom("programs").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", user.id).executeTakeFirst(),
    countUserAffiliates(user.id),
    db.selectFrom("usage_monthly").select(["conversions"]).where("user_id", "=", user.id).where("month", "=", month).executeTakeFirst(),
    getEntitlements(user),
  ]);
  const programs = await db.selectFrom("programs").select(["id", "name", "slug", "domain", "currency", "status", "verified_at"]).where("user_id", "=", user.id).orderBy("id").limit(50).execute();
  const programIds = programs.map((p) => p.id);
  const [programAffiliates, programConversions] = programIds.length
    ? await Promise.all([
        db.selectFrom("affiliates").select((eb) => ["program_id", eb.fn.countAll<number>().as("n")]).where("program_id", "in", programIds).groupBy("program_id").execute(),
        // The same 30 UTC days as the owner's dashboard.
        getProgramsPeriodTotals(programIds, periodRange(30)),
      ])
    : [[], new Map<number, { n: number; revenue: number; commission: number }>()];
  const affiliatesBy = new Map(programAffiliates.map((r) => [r.program_id, Number(r.n ?? 0)]));
  const conversionsBy = programConversions;
  const programsUsed = Number(programCount?.n ?? 0);
  const monthUsed = Number(usage?.conversions ?? 0);
  const limit = (n: number) => (n ? n.toLocaleString() : "Unlimited");

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <>
            Joined {formatDate(user.created_at)}.{" "}
            <Link href="/admin/users" className="text-primary hover:underline">
              Back to users
            </Link>
          </>
        }
      />
      {created ? <Alert tone="success" className="mb-4">User created.</Alert> : null}
      <UserForm
        isSelf={me?.id === user.id}
        plans={plans.filter((p) => !p.is_free).map((p) => ({ id: p.id, name: p.name }))}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          planId: user.plan_id ?? 0,
          planExpires: user.plan_expires_at ? user.plan_expires_at.slice(0, 10) : "",
        }}
      />
      <Card title="Programs and usage" className="mt-6 max-w-3xl">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Programs</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {programsUsed.toLocaleString()} <span className="text-sm font-normal text-muted">/ {limit(entitlements.maxPrograms)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Affiliates</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {affiliateCount.toLocaleString()} <span className="text-sm font-normal text-muted">/ {limit(entitlements.maxAffiliates)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Conversions this month</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {monthUsed.toLocaleString()} <span className="text-sm font-normal text-muted">/ {limit(entitlements.maxMonthlyConversions)}</span>
            </dd>
            {entitlements.maxMonthlyConversions > 0 && monthUsed >= entitlements.maxMonthlyConversions * 0.8 ? (
              <Badge tone={monthUsed >= entitlements.maxMonthlyConversions ? "danger" : "warning"} className="mt-1">
                {Math.floor((monthUsed / entitlements.maxMonthlyConversions) * 100)}% used
              </Badge>
            ) : null}
          </div>
          <div>
            <dt className="text-muted">Plan</dt>
            <dd className="mt-1 text-lg font-semibold">{user.role === "admin" ? "Administrator" : (entitlements.plan?.name ?? "Free")}</dd>
            <dd className="text-xs text-muted">REST API: {entitlements.allowApi ? "yes" : "no"}</dd>
          </div>
        </dl>
        {programs.length ? (
          <div className="-mx-5 mt-5 -mb-5 border-t border-line">
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>Program</Th>
                  <Th className="text-right">Affiliates</Th>
                  <Th className="text-right">Conversions, 30 d</Th>
                  <Th className="text-right">Revenue, 30 d</Th>
                  <Th>Tracking</Th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => {
                  const conv = conversionsBy.get(p.id) ?? { n: 0, revenue: 0 };
                  return (
                    <tr key={p.id}>
                      <Td>
                        <Link href={`/a/${p.slug}`} target="_blank" className="font-medium hover:text-primary hover:underline">
                          {p.name}
                        </Link>
                        <span className="block text-xs text-muted">
                          {p.domain}
                          {p.status === "paused" ? " · paused" : ""}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{(affiliatesBy.get(p.id) ?? 0).toLocaleString()}</Td>
                      <Td className="text-right tabular-nums">{conv.n.toLocaleString()}</Td>
                      <Td className="text-right tabular-nums">{formatMoneyMinor(conv.revenue, p.currency, "en-US")}</Td>
                      <Td>{p.verified_at ? <Badge tone="success">Verified</Badge> : <Badge>Not installed</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">No referral programs yet.</p>
        )}
      </Card>
      <Card title="Payments" padded={false} className="mt-6 max-w-3xl">
        {payments.length ? (
          <Table minWidth={520}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDate(p.created_at)}</Td>
                  <Td>{GATEWAY_LABELS[p.provider]}</Td>
                  <Td className="tabular-nums">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"} className="capitalize">
                      {p.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="p-5 text-sm text-muted">No payments.</p>
        )}
      </Card>
    </>
  );
}
