import Link from "next/link";
import { AffiliateResetForm } from "@/components/portal/auth-forms";
import { AuthCard } from "@/components/site/auth-card";
import { Alert } from "@/components/ui/alert";
import { getDb, now } from "@/lib/db";
import { loadPortal } from "@/lib/portal-page";
import { sha256 } from "@/lib/tokens";

export const metadata = { title: "Choose a password" };

/** Password reset and merchant invitations: /a/<slug>/reset?token=… */
export default async function PortalReset({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { program, t } = await loadPortal(slug);
  const token = typeof query.token === "string" ? query.token.slice(0, 200) : "";

  // Check the link up front so an expired one says so before the affiliate types a password.
  let valid = false;
  let firstPassword = false;
  let email = "";
  if (token.length >= 20) {
    const db = await getDb();
    const row = await db
      .selectFrom("affiliate_password_resets")
      .innerJoin("affiliates", "affiliates.id", "affiliate_password_resets.affiliate_id")
      .select(["affiliate_password_resets.expires_at", "affiliates.program_id", "affiliates.password_hash", "affiliates.status", "affiliates.email"])
      .where("affiliate_password_resets.token_hash", "=", sha256(token))
      .executeTakeFirst();
    if (row && row.program_id === program.id && row.expires_at >= now() && row.status !== "blocked") {
      valid = true;
      firstPassword = !row.password_hash;
      email = row.email;
    }
  }

  return (
    <AuthCard
      title={firstPassword ? t("portal.reset.titleFirst") : t("portal.reset.title")}
      subtitle={valid ? (firstPassword ? t("portal.reset.subtitleFirst", { program: program.name, email }) : t("portal.reset.subtitle", { email })) : undefined}
      footer={
        <Link href={`/a/${slug}/login`} className="font-medium text-primary-text hover:underline">
          {t("portal.forgot.back")}
        </Link>
      }
    >
      {valid ? (
        <AffiliateResetForm slug={slug} token={token} firstPassword={firstPassword} />
      ) : (
        <div className="space-y-4">
          <Alert tone="error">{t("portal.err.linkInvalid")}</Alert>
          <Link href={`/a/${slug}/forgot`} className="inline-block text-sm font-medium text-primary-text hover:underline">
            {t("portal.reset.requestNew")}
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
