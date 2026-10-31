import Link from "next/link";
import { redirect } from "next/navigation";
import { AffiliateSignupForm } from "@/components/portal/auth-forms";
import { AuthCard } from "@/components/site/auth-card";
import { Alert } from "@/components/ui/alert";
import { isDemoMode } from "@/lib/config";
import { commissionHeadline, loadPortal } from "@/lib/portal-page";

export const metadata = { title: "Join" };

export default async function PortalSignup({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t, locale, availability } = await loadPortal(slug);
  if (affiliate) redirect(`/a/${slug}/dashboard`);
  const paused = availability !== "active";
  return (
    <AuthCard
      title={t("portal.signup.title", { program: program.name })}
      subtitle={commissionHeadline(program, t, locale)}
      footer={
        <>
          {t("portal.signup.haveAccount")}{" "}
          <Link href={`/a/${slug}/login`} className="font-medium text-primary-text hover:underline">
            {t("portal.nav.login")}
          </Link>
        </>
      }
    >
      {paused ? (
        <Alert tone="warning" title={availability === "paused" ? t("portal.paused") : t("portal.unavailable")}>
          {availability === "paused" ? t("portal.pausedSignup") : t("portal.unavailableText")}
        </Alert>
      ) : (
        <>
          {isDemoMode() ? (
            <Alert tone="info" className="mb-4">
              {t("portal.err.demoSignup")}
            </Alert>
          ) : !program.settings.autoApprove ? (
            <Alert tone="info" className="mb-4">
              {t("portal.signup.reviewNote")}
            </Alert>
          ) : null}
          <AffiliateSignupForm slug={slug} hasTerms={Boolean(program.settings.terms.trim())} demo={isDemoMode()} />
        </>
      )}
    </AuthCard>
  );
}
