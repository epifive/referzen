import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function PortalNotFound() {
  const t = await getT();
  return (
    <main className="mat-grid grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="font-display text-6xl font-bold text-primary">404</p>
        <h1 className="mt-4 text-2xl font-bold">{t("portal.notFound.title")}</h1>
        <p className="mt-2 text-muted">{t("portal.notFound.text")}</p>
        <Link href="/" className="mt-6 inline-block font-medium text-primary hover:underline">
          {t("portal.notFound.home")}
        </Link>
      </div>
    </main>
  );
}
