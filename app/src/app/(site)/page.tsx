import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Commissions } from "@/components/site/landing/commissions";
import { Faq } from "@/components/site/landing/faq";
import { Features } from "@/components/site/landing/features";
import { FinalCta } from "@/components/site/landing/final-cta";
import { rateLabel } from "@/components/site/landing/format";
import { Hero, ProofStrip } from "@/components/site/landing/hero";
import { HowItWorks } from "@/components/site/landing/how-it-works";
import { Integrations } from "@/components/site/landing/integrations";
import { PortalShowcase, type ShowcaseProgram } from "@/components/site/landing/portal-showcase";
import { PricingTeaser, type TeaserPlan } from "@/components/site/landing/pricing-teaser";
import { PostCard } from "@/components/site/post-card";
import { getLatestPosts } from "@/lib/blog";
import type { Translator } from "@/lib/i18n/messages";
import { getT, localSetting } from "@/lib/i18n/server";
import { getActivePlans } from "@/lib/plans";
import { getProgramBySlug, portalPath } from "@/lib/programs";
import { absoluteUrl, getSiteContext } from "@/lib/site";

/** The showcase program (Admin → Settings → "Showcase program"), when it exists and is active. */
async function loadShowcase(slug: string, t: Translator, locale: string): Promise<ShowcaseProgram | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  try {
    const program = await getProgramBySlug(slug);
    if (!program || program.status !== "active") return null;
    return { name: program.name, href: portalPath(program.slug), rate: rateLabel(program.settings, program.currency, t, locale) };
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "example.com";
  }
}

export default async function HomePage() {
  const { settings, user, blogVisible, locale } = await getSiteContext();
  const t = await getT();
  const [heroTitle, heroSubtitle, posts, plans, showcase] = await Promise.all([
    localSetting(settings, "home_hero_title"),
    localSetting(settings, "home_hero_subtitle"),
    blogVisible ? getLatestPosts(3) : Promise.resolve([]),
    getActivePlans(),
    loadShowcase(settings.showcase_program_slug, t, locale.code),
  ]);

  const signedIn = Boolean(user);
  const site = settings.site_name;
  const currency = settings.currency || "USD";
  const scriptUrl = absoluteUrl(settings, "/rz.js");
  const teaserPlans: TeaserPlan[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceMonthly: p.price_monthly,
    isFree: p.is_free === 1,
    isFeatured: p.is_featured === 1,
    maxPrograms: p.max_programs,
    maxAffiliates: p.max_affiliates,
    maxMonthlyConversions: p.max_monthly_conversions,
  }));

  return (
    <>
      <Hero
        t={t}
        title={heroTitle}
        subtitle={heroSubtitle}
        signedIn={signedIn}
        portalHref={showcase?.href ?? null}
        site={site}
        locale={locale.code}
        currency={currency}
      />
      {settings.show_stats_on_home ? <ProofStrip t={t} /> : null}
      <HowItWorks t={t} site={site} locale={locale.code} currency={currency} scriptUrl={scriptUrl} />
      <Features t={t} />
      <PortalShowcase t={t} locale={locale.code} currency={currency} host={hostOf(absoluteUrl(settings))} live={showcase} />
      <Commissions t={t} locale={locale.code} currency={currency} holdDays={settings.default_hold_days} />
      <Integrations t={t} site={site} scriptUrl={scriptUrl} />
      <PricingTeaser t={t} plans={teaserPlans} currency={currency} locale={locale.code} />
      <Faq t={t} site={site} contact={settings.contact_enabled} />

      {posts.length ? (
        <section aria-labelledby="posts-title" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="posts-title" className="text-3xl font-bold tracking-tight">
              {t("home.latestPosts")}
            </h2>
            <Link href="/blog" className="group inline-flex items-center gap-1.5 font-semibold text-primary-text hover:underline">
              {t("home.allPosts")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} readMore={t("blog.readMore")} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FinalCta t={t} signedIn={signedIn} />
    </>
  );
}
