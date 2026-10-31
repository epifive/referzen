import type { Metadata } from "next";
import { Crown, KeyRound, Trash2 } from "lucide-react";
import { deleteApiKeyAction } from "@/app/actions/dashboard/apikeys";
import { ActionButton } from "@/components/dashboard/actions";
import { CreateApiKeyForm } from "@/components/dashboard/api-key-forms";
import { CopyButton } from "@/components/dashboard/copy";
import { CodeBlock, DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getUserApiKeys } from "@/lib/api-keys";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { requireDashboardUser } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { getEntitlements } from "@/lib/plans";
import { baseUrl } from "@/lib/request";
import { getUserPrograms } from "@/lib/programs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.api.title") };
}

export default async function ApiKeysPage() {
  const user = await requireDashboardUser();
  const [t, locale, entitlements, keys, origin, programs] = await Promise.all([getT(), getLocale(), getEntitlements(user), getUserApiKeys(user.id), baseUrl(), getUserPrograms(user.id)]);
  const programId = programs[0]?.id ?? 1;
  const curl = [
    `curl -X POST "${origin}/api/v1/conversions" \\`,
    `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"program_id": ${programId}, "order_id": "1001", "amount": 49.00, "currency": "USD", "email": "customer@example.com"}'`,
  ].join("\n");
  const endpoints: Array<[string, string]> = [
    ["GET /api/v1/programs", t("dash.api.epPrograms")],
    ["GET /api/v1/affiliates", t("dash.api.epAffiliates")],
    ["POST /api/v1/referrals", t("dash.api.epReferrals")],
    ["POST /api/v1/conversions", t("dash.api.epConversions")],
  ];

  return (
    <div className="space-y-6">
      <DashHeader title={t("dash.api.title")} description={t("dash.api.subtitle")} />

      {!entitlements.allowApi ? (
        <Alert tone="warning" title={t("dash.api.upgradeTitle")}>
          <p>{t("dash.api.upgrade")}</p>
          <ButtonLink href="/pricing" size="sm" className="mt-3">
            <Crown aria-hidden />
            {t("dash.banner.cta")}
          </ButtonLink>
        </Alert>
      ) : (
        <Panel title={t("dash.api.createTitle")} description={t("dash.api.createText")}>
          <CreateApiKeyForm disabled={false} />
        </Panel>
      )}

      <Panel title={t("dash.api.list")} padded={false}>
        {keys.length ? (
          <DTable minWidth={620} label={t("dash.api.list")}>
            <thead>
              <tr>
                <DTh>{t("dash.api.name")}</DTh>
                <DTh>{t("dash.api.key")}</DTh>
                <DTh>{t("dash.api.createdAt")}</DTh>
                <DTh>{t("dash.api.lastUsed")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.api.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <DTd>
                    <span dir="auto" className="font-medium">
                      {k.name}
                    </span>
                  </DTd>
                  <DTd>
                    <code dir="ltr" className="font-mono text-[13px] text-muted">
                      {k.prefix}…
                    </code>
                  </DTd>
                  <DTd className="text-muted">{formatDateTime(k.createdAt, locale.code, false)}</DTd>
                  <DTd className="text-muted">{k.lastUsedAt ? formatRelative(k.lastUsedAt, locale.code) : t("dash.api.never")}</DTd>
                  <DTd className="text-end">
                    <ActionButton
                      action={deleteApiKeyAction}
                      fields={{ key_id: k.id }}
                      variant="ghost"
                      confirmText={t("dash.api.revokeConfirm", { name: k.name })}
                      className="items-end"
                    >
                      <Trash2 aria-hidden />
                      {t("dash.api.revoke")}
                    </ActionButton>
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<KeyRound />} title={t("dash.api.emptyTitle")}>
            {t("dash.api.emptyText")}
          </Empty>
        )}
      </Panel>

      <Panel title={t("dash.api.docsTitle")} description={t("dash.api.docsText")}>
        <ul className="mb-5 space-y-2 text-sm">
          {endpoints.map(([ep, text]) => (
            <li key={ep} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <code dir="ltr" className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">
                {ep}
              </code>
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
        <div className="relative">
          <CodeBlock>{curl}</CodeBlock>
          <CopyButton text={curl} className="absolute end-2 top-2" />
        </div>
        <p className="mt-3 text-xs text-muted">{t("dash.api.params")}</p>
      </Panel>
    </div>
  );
}
