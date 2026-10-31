import Link from "next/link";
import { redirect } from "next/navigation";
import { AffiliateLoginForm } from "@/components/portal/auth-forms";
import { AuthCard } from "@/components/site/auth-card";
import { Alert } from "@/components/ui/alert";
import { getAffiliateByEmail } from "@/lib/affiliates";
import { demoAffiliateLogin, isDemoMode } from "@/lib/config";
import { loadPortal } from "@/lib/portal-page";

export const metadata = { title: "Log in" };

export default async function PortalLogin({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ signedOut?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { program, affiliate, t, availability } = await loadPortal(slug);
  if (affiliate) redirect(`/a/${slug}/dashboard`);
  // The demo shows a ready-made affiliate account (src/lib/db/demo-programs.ts) in the programs that have it.
  const login = isDemoMode() ? demoAffiliateLogin() : null;
  const demoAccount = login ? await getAffiliateByEmail(program.id, login.email) : undefined;
  const demo = login && demoAccount?.hasPassword ? login : undefined;
  return (
    <AuthCard
      title={t("portal.login.title")}
      subtitle={t("portal.login.subtitle", { program: program.name })}
      footer={
        availability !== "active" ? undefined : (
          <>
            {t("portal.login.noAccount")}{" "}
            <Link href={`/a/${slug}/signup`} className="font-medium text-primary-text hover:underline">
              {t("portal.nav.join")}
            </Link>
          </>
        )
      }
    >
      {query.signedOut ? (
        <Alert tone="success" className="mb-4">
          {t("portal.login.signedOut")}
        </Alert>
      ) : null}
      {demo ? (
        <Alert tone="info" className="mb-4">
          {t("portal.login.demo")}
        </Alert>
      ) : null}
      <AffiliateLoginForm slug={slug} demo={demo} />
    </AuthCard>
  );
}
