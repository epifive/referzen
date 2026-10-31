import { CircleDollarSign, Cookie, Link2, Repeat, UserPlus, Wallet } from "lucide-react";
import { PortalSection } from "@/components/portal/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { commissionHeadline, fmtMoney, loadPortal, rateText, recurringText } from "@/lib/portal-page";
import { renderMerchantMarkdown } from "@/lib/portal-terms";
import { formatList } from "@/lib/dash-format";
import { plural, type MessageKey } from "@/lib/i18n/messages";

export default async function PortalLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program, affiliate, t, locale, availability } = await loadPortal(slug);
  const s = program.settings;
  const [introHtml, termsHtml] = await Promise.all([renderMerchantMarkdown(s.portalIntro), renderMerchantMarkdown(s.terms)]);
  const headline = s.portalHeadline || t("portal.landing.defaultHeadline", { program: program.name });
  const paused = availability !== "active";

  const facts: Array<[string, string]> = [
    [t("portal.landing.commission"), rateText(program, locale)],
    [t("portal.landing.recurring"), recurringText(program, t)],
    [t("portal.landing.cookie"), plural(t, "portal.daysCount", s.cookieDays)],
    [t("portal.landing.hold"), s.holdDays > 0 ? plural(t, "portal.daysCount", s.holdDays) : t("portal.landing.noHold")],
    [t("portal.landing.minimum"), s.minPayoutCents > 0 ? fmtMoney(s.minPayoutCents, program.currency, locale) : t("portal.landing.noMinimum")],
    [t("portal.landing.methods"), formatList(s.payoutMethods.map((m) => t(`portal.method.${m}` as MessageKey)), locale)],
  ];

  const chips = [
    { icon: Repeat, label: recurringText(program, t) },
    { icon: Cookie, label: t("portal.landing.cookieChip", { days: s.cookieDays }) },
    { icon: Wallet, label: s.minPayoutCents > 0 ? t("portal.landing.minimumChip", { amount: fmtMoney(s.minPayoutCents, program.currency, locale) }) : t("portal.landing.noMinimum") },
  ];

  const steps = [
    { icon: UserPlus, title: t("portal.landing.step1"), text: s.autoApprove ? t("portal.landing.step1Auto") : t("portal.landing.step1Review") },
    { icon: Link2, title: t("portal.landing.step2"), text: t("portal.landing.step2Text") },
    { icon: CircleDollarSign, title: t("portal.landing.step3"), text: t("portal.landing.step3Text", { commission: commissionHeadline(program, t, locale) }) },
  ];

  return (
    <>
      <section className="mat-grid relative border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.5fr_1fr]">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary-text uppercase">{t("portal.landing.eyebrow", { program: program.name })}</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-[1.1] sm:text-5xl tall-script:leading-[1.35]" dir="auto">
              {headline}
            </h1>
            {introHtml ? (
              <div className="prose-tz mt-5 text-lg text-muted [&>:first-child]:mt-0" dir="auto" dangerouslySetInnerHTML={{ __html: introHtml }} />
            ) : (
              <p className="mt-5 text-lg text-muted">{t("portal.landing.defaultIntro", { commission: commissionHeadline(program, t, locale), days: s.cookieDays })}</p>
            )}
            {paused ? (
              <Alert tone="warning" className="mt-6" title={availability === "paused" ? t("portal.paused") : t("portal.unavailable")}>
                {availability === "paused" ? t("portal.pausedText") : t("portal.unavailableText")}
              </Alert>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              {affiliate ? (
                <ButtonLink href={`/a/${slug}/dashboard`} size="lg">
                  {t("portal.landing.toDashboard")}
                </ButtonLink>
              ) : (
                <>
                  {!paused ? (
                    <ButtonLink href={`/a/${slug}/signup`} size="lg">
                      {t("portal.landing.join")}
                    </ButtonLink>
                  ) : null}
                  <ButtonLink href={`/a/${slug}/login`} size="lg" variant="outline">
                    {t("portal.landing.login")}
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
          <aside aria-label={t("portal.landing.detailsTitle")} className="rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_48px_-28px_rgb(0_0_0/0.25)]">
            <p className="text-sm font-medium text-muted">{t("portal.landing.commission")}</p>
            <p className="mt-1 font-display text-5xl font-bold text-primary-text tabular-nums">{rateText(program, locale)}</p>
            <p className="mt-1 text-sm text-muted">{s.commissionType === "percent" ? t("portal.landing.perSalePercent") : t("portal.landing.perSaleFixed")}</p>
            <ul className="mt-6 space-y-3 text-sm">
              {chips.map((chip) => (
                <li key={chip.label} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
                    <chip.icon className="size-4" aria-hidden />
                  </span>
                  {chip.label}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <h2 className="font-display text-2xl font-bold">{t("portal.landing.howTitle")}</h2>
          <ol className="mt-6 space-y-5">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-text">
                  <step.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-sans text-base font-semibold tracking-normal">
                    <span className="text-muted tabular-nums">{i + 1}. </span>
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <PortalSection title={t("portal.landing.detailsTitle")}>
          <p className="mb-4 font-display text-3xl font-bold text-primary-text">{commissionHeadline(program, t, locale)}</p>
          <dl className="divide-y divide-line text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{label}</dt>
                <dd className="text-end font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </PortalSection>
      </div>

      {termsHtml ? (
        <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
          <PortalSection id="terms" title={t("portal.landing.terms")} className="scroll-mt-20">
            <div className="prose-tz text-sm [&>:first-child]:mt-0" dir="auto" dangerouslySetInnerHTML={{ __html: termsHtml }} />
          </PortalSection>
        </div>
      ) : null}
    </>
  );
}
