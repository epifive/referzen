"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { affiliateLogout } from "@/app/actions/portal/auth";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { ThemeToggle, type ThemeChoice } from "@/components/site/theme";
import { buttonClass } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** The program's logo, or its initial on the brand colour. */
export function ProgramMark({ name, logo, className }: { name: string; logo: string; className?: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element -- merchant-uploaded logo of unknown size
    return <img src={logo} alt="" className={cn("h-9 w-auto max-w-40 object-contain", className)} />;
  }
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "A";
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-primary font-display text-lg font-bold text-white", className)}>
      {initial}
    </span>
  );
}

export function PortalHeader({
  slug,
  programName,
  logo,
  affiliate,
  languages,
  locale,
  defaultTheme,
  joinable = true,
}: {
  slug: string;
  programName: string;
  logo: string;
  affiliate: { name: string; email: string } | null;
  languages: Array<{ code: string; name: string }>;
  locale: string;
  defaultTheme: ThemeChoice;
  /** False while the program is paused or unavailable: no "Join" button. */
  joinable?: boolean;
}) {
  const t = useT();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href={`/a/${slug}${affiliate ? "/dashboard" : ""}`} className="flex min-w-0 items-center gap-2.5">
          <ProgramMark name={programName} logo={logo} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-display text-base font-bold text-ink sm:text-lg" dir="auto">
              {programName}
            </span>
            <span className="block truncate text-xs text-muted">{t("portal.header.tagline")}</span>
          </span>
        </Link>
        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {languages.length > 1 ? <LanguageSwitcher current={locale} languages={languages} /> : null}
          <ThemeToggle defaultTheme={defaultTheme} />
          {affiliate ? (
            <>
              <span className="hidden max-w-44 truncate px-2 text-sm text-muted md:block" title={affiliate.email} dir="auto">
                {affiliate.name}
              </span>
              <form action={affiliateLogout}>
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className={buttonClass("ghost", "sm")} aria-label={t("portal.nav.logout")}>
                  <LogOut aria-hidden />
                  <span className="max-sm:hidden">{t("portal.nav.logout")}</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href={`/a/${slug}/login`} className="rounded-lg px-2 py-2 text-sm font-medium text-muted hover:text-ink sm:px-3">
                {t("portal.nav.login")}
              </Link>
              {joinable ? (
                <Link href={`/a/${slug}/signup`} className={buttonClass("primary", "sm", "max-[360px]:hidden")}>
                  {t("portal.nav.join")}
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PortalFooter({ slug, programName, hasTerms, branding }: { slug: string; programName: string; hasTerms: boolean; branding: { text: string; url: string } | null }) {
  const t = useT();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
        <p>
          <bdi>{programName}</bdi> · {t("portal.header.tagline")}
          {hasTerms ? (
            <>
              {" · "}
              <Link href={`/a/${slug}#terms`} className="hover:text-ink hover:underline">
                {t("portal.landing.terms")}
              </Link>
            </>
          ) : null}
        </p>
        {branding && branding.text.trim() ? (
          <a href={branding.url} target="_blank" rel="noopener" className="text-xs hover:text-ink">
            {branding.text}
          </a>
        ) : null}
      </div>
    </footer>
  );
}

const TABS = [
  { page: "dashboard", key: "portal.nav.overview" },
  { page: "links", key: "portal.nav.links" },
  { page: "earnings", key: "portal.nav.earnings" },
  { page: "assets", key: "portal.nav.assets" },
  { page: "settings", key: "portal.nav.settings" },
] as const;

/** Fades the edge(s) of a sideways-scrolling bar where more tabs are hidden. */
function edgeMask(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  return `linear-gradient(to right, ${left ? "transparent, #000 2.5rem" : "#000"}, ${right ? "#000 calc(100% - 2.5rem), transparent" : "#000"})`;
}

/** Tabs of the signed-in portal. On phones they scroll sideways, with a fade where more tabs are. */
export function PortalTabs({ slug }: { slug: string }) {
  const t = useT();
  const pathname = usePathname();
  const current = pathname.split("/")[3] ?? "dashboard";
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bring the current tab into view (e.g. Settings on a narrow phone).
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const a = active.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (a.right > b.right) el.scrollLeft += a.right - b.right + 24;
      else if (a.left < b.left) el.scrollLeft -= b.left - a.left + 24;
    }
    const update = () => {
      const b = el.getBoundingClientRect();
      const items = el.querySelectorAll("li");
      if (!items.length) return;
      const first = items[0].getBoundingClientRect();
      const last = items[items.length - 1].getBoundingClientRect();
      // Works for both directions (RTL lists start on the right).
      const minLeft = Math.min(first.left, last.left);
      const maxRight = Math.max(first.right, last.right);
      setEdges({ left: minLeft < b.left - 1, right: maxRight > b.right + 1 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [current]);
  const mask = edgeMask(edges.left, edges.right);
  return (
    <nav
      ref={ref}
      aria-label={t("portal.nav.label")}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((tab) => {
          const active = tab.page === current;
          return (
            <li key={tab.page}>
              <Link
                href={`/a/${slug}/${tab.page}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                  active ? "border-primary text-primary-text" : "border-transparent text-muted hover:border-line hover:text-ink",
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
