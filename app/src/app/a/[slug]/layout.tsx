import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandStyle } from "@/components/site/brand-style";
import { HtmlLang } from "@/components/site/html-lang";
import { PortalFooter, PortalHeader } from "@/components/portal/chrome";
import { I18nProvider } from "@/lib/i18n/client";
import { getActiveLanguages, getClientMessages } from "@/lib/i18n/server";
import { maybeLazyTick } from "@/lib/lazy-tick";
import { getPortalProgram } from "@/lib/portal-session";
import { loadPortal } from "@/lib/portal-page";
import { getSettings, type Settings } from "@/lib/settings";
import { absoluteUrl, uploadUrl } from "@/lib/site";
import type { ThemeChoice } from "@/components/site/theme";

// Program settings and sessions are read at request time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [program, settings] = await Promise.all([getPortalProgram(slug), getSettings()]);
  const base = siteBase(settings);
  if (!program) return { metadataBase: base, robots: { index: false, follow: false } };
  const logo = program.settings.logo ? uploadUrl(program.settings.logo) : "";
  return {
    metadataBase: base,
    title: { default: `${program.name} affiliate program`, template: `%s · ${program.name}` },
    description: program.settings.portalHeadline || `Join the ${program.name} affiliate program and earn a commission on every customer you refer.`,
    // Portals belong to the platform's customers: keep them out of search engines.
    robots: { index: false, follow: false },
    icons: logo && /\.(png|svg|ico|jpe?g|webp)$/i.test(logo) ? { icon: logo } : settings.favicon ? { icon: uploadUrl(settings.favicon) } : { icon: "/icon.svg" },
  };
}

function siteBase(settings: Settings): URL {
  try {
    return new URL(absoluteUrl(settings));
  } catch {
    return new URL("http://localhost:3000");
  }
}

export default async function PortalLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  maybeLazyTick();
  const [settings, messages, languages] = await Promise.all([getSettings(), getClientMessages(), getActiveLanguages()]);
  const color = ctx.program.settings.brandColor || settings.primary_color;

  return (
    <I18nProvider messages={messages}>
      <HtmlLang code={ctx.locale} dir={ctx.dir} />
      <BrandStyle color={color} />
      <div dir={ctx.dir} lang={ctx.locale} className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
        >
          {ctx.t("nav.skipToContent")}
        </a>
        <PortalHeader
          slug={slug}
          programName={ctx.program.name}
          logo={ctx.program.settings.logo ? uploadUrl(ctx.program.settings.logo) : ""}
          affiliate={ctx.affiliate ? { name: ctx.affiliate.name, email: ctx.affiliate.email } : null}
          languages={languages.map((l) => ({ code: l.code, name: l.native_name }))}
          locale={ctx.locale}
          defaultTheme={settings.default_theme as ThemeChoice}
          joinable={ctx.availability === "active"}
        />
        <main id="main" className="flex-1">
          {children}
        </main>
        <PortalFooter
          slug={slug}
          programName={ctx.program.name}
          hasTerms={Boolean(ctx.program.settings.terms.trim())}
          branding={ctx.removeBranding ? null : { text: settings.branding_text, url: settings.branding_url || absoluteUrl(settings, "/") }}
        />
      </div>
    </I18nProvider>
  );
}
