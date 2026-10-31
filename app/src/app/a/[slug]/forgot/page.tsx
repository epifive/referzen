import Link from "next/link";
import { AffiliateForgotForm } from "@/components/portal/auth-forms";
import { AuthCard } from "@/components/site/auth-card";
import { loadPortal } from "@/lib/portal-page";

export const metadata = { title: "Forgot password" };

export default async function PortalForgot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { t } = await loadPortal(slug);
  return (
    <AuthCard
      title={t("portal.forgot.title")}
      subtitle={t("portal.forgot.subtitle")}
      footer={
        <Link href={`/a/${slug}/login`} className="font-medium text-primary-text hover:underline">
          {t("portal.forgot.back")}
        </Link>
      }
    >
      <AffiliateForgotForm slug={slug} />
    </AuthCard>
  );
}
