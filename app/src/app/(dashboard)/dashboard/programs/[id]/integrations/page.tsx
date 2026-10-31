import type { Metadata } from "next";
import Link from "next/link";
import { Braces, CircleCheck, Clock, Code2, CreditCard, ExternalLink, RefreshCw, ShoppingBag, ShoppingCart, Terminal, Webhook } from "lucide-react";
import { regenerateKeyAction, regenerateWebhookAction } from "@/app/actions/dashboard/programs";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { CopyButton, CopyField } from "@/components/dashboard/copy";
import { GuideTabs, TestEventButton, WebhookSecretForm } from "@/components/dashboard/integration-panels";
import { Step } from "@/components/dashboard/merchant-ui";
import { CodeBlock, DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { listProgramAffiliates } from "@/lib/affiliates";
import { formatRelative } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { programPath, requireProgram } from "@/lib/merchant-program";
import { getSetupStatus } from "@/lib/merchant-stats";
import { getEntitlements } from "@/lib/plans";
import { portalPath, webhookPath } from "@/lib/programs";
import { baseUrl } from "@/lib/request";
import { SAMPLE_REFERRAL_TOKEN, WEBHOOK_SAMPLES, type WebhookSample } from "@/lib/webhooks/samples";
import { referralLink } from "@/referral/normalize";
import { DEFAULT_PROGRAM_SETTINGS } from "@/referral/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.integrations") };
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <CodeBlock className="pe-24">{code}</CodeBlock>
      <CopyButton text={code} className="absolute end-2 top-2" />
    </div>
  );
}

export default async function IntegrationsPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { user, program } = await requireProgram(id);
  const [t, locale, origin, setup, entitlements, sampleAffiliates] = await Promise.all([
    getT(),
    getLocale(),
    baseUrl(),
    getSetupStatus(program),
    getEntitlements(user),
    listProgramAffiliates(program.id, { status: "approved", limit: 1 }),
  ]);
  const s = program.settings;
  const customParams = s.refParams.join(",") !== DEFAULT_PROGRAM_SETTINGS.refParams.join(",");
  const snippet = `<script async src="${origin}/rz.js" data-program="${program.publicKey}"${customParams ? ` data-param="${s.refParams.join(",")}"` : ""}></script>`;
  const hookUrl = `${origin}${webhookPath(program.webhookToken)}`;
  const portalUrl = `${origin}${portalPath(program.slug)}`;
  const testCode = sampleAffiliates[0]?.code ?? "test";
  const testLink = referralLink(program.domain, testCode, { param: s.refParams[0] });
  const samples = (preset: WebhookSample["preset"]) => WEBHOOK_SAMPLES.filter((x) => x.preset === preset);
  const tests = (preset: WebhookSample["preset"]) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink">{t("dash.int.testTitle")}</p>
      <p className="text-xs text-muted">{t("dash.int.testText")}</p>
      {samples(preset).map((x) => (
        <TestEventButton key={x.id} programId={program.id} sampleId={x.id} title={x.title} description={x.description} canReal={JSON.stringify(x.body).includes(SAMPLE_REFERRAL_TOKEN)} />
      ))}
    </div>
  );
  const webhookStep = (n: number, where: string) => (
    <Step n={n} title={t("dash.int.webhookStep")}>
      <p>{where}</p>
      <CopyField value={hookUrl} label={t("dash.int.webhookUrl")} />
    </Step>
  );

  const stripeCheckout = `const session = await stripe.checkout.sessions.create({
  mode: "subscription", // or "payment"
  line_items: [{ price: "price_123", quantity: 1 }],
  // The referral from the visitor's browser: window.referzen.referral
  client_reference_id: req.body.referzen || undefined,
  metadata: { referzen: req.body.referzen || "" },
  success_url: "https://${program.domain}/thanks",
});`;
  // Saves the rz_ref cookie in the order meta "_referzen", which the WooCommerce webhook reads.
  const wooSnippet = `<?php
// Referzen: remember the affiliate referral of the order (theme functions.php or a code snippets plugin).
function referzen_save_referral( $order ) {
    if ( ! empty( $_COOKIE['rz_ref'] ) && preg_match( '/^[A-Za-z0-9]{16,32}$/', $_COOKIE['rz_ref'] ) ) {
        $order->update_meta_data( '_referzen', sanitize_text_field( $_COOKIE['rz_ref'] ) );
    }
}
// Classic checkout.
add_action( 'woocommerce_checkout_create_order', 'referzen_save_referral' );
// Block checkout (WooCommerce 8.3+).
add_action( 'woocommerce_store_api_checkout_update_order_from_request', 'referzen_save_referral' );`;
  const jsSignup = `// After a visitor creates an account or starts a trial (records a lead):
window.referzen && window.referzen.signup({
  email: "customer@example.com",
  customerId: "cus_123" // your customer id, e.g. the Stripe customer
});`;
  const jsConvert = `// Client-side conversion on the thank-you page (lower trust, flagged):
window.referzen && window.referzen.convert({
  amount: 49.0,
  currency: "${program.currency}",
  orderId: "1001",
  email: "customer@example.com"
});`;
  const curl = `curl -X POST "${origin}/api/v1/conversions" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"program_id": ${program.id}, "order_id": "1001", "amount": 49.00, "currency": "${program.currency}", "referral": "REFERRAL_TOKEN", "email": "customer@example.com"}'`;
  const curlLead = `curl -X POST "${origin}/api/v1/referrals" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"program_id": ${program.id}, "referral": "REFERRAL_TOKEN", "email": "customer@example.com", "customer_id": "cus_123"}'`;
  const attrs: Array<[string, string]> = [
    ["data-param", t("dash.int.attrParam")],
    ["data-domain", t("dash.int.attrDomain")],
    ["data-api", t("dash.int.attrApi")],
    ["data-respect-dnt", t("dash.int.attrDnt")],
  ];

  const tabs = [
    {
      id: "stripe",
      label: "Stripe",
      icon: <CreditCard className="size-4" aria-hidden />,
      content: (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ol>
            <Step n={1} title={t("dash.int.stripe1")}>
              <p>{t("dash.int.stripe1Text")}</p>
              <Snippet code={stripeCheckout} />
              <p>{t("dash.int.stripeLinks")}</p>
            </Step>
            {webhookStep(2, t("dash.int.stripe2Text"))}
            <Step n={3} title={t("dash.int.stripe3")}>
              <p>{t("dash.int.stripe3Text")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {[
                  "checkout.session.completed",
                  "checkout.session.async_payment_succeeded",
                  "invoice.paid",
                  "charge.refunded",
                  "refund.created",
                  "charge.dispute.created",
                ].map((e) => (
                  <li key={e}>
                    <code dir="ltr" className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink">
                      {e}
                    </code>
                  </li>
                ))}
              </ul>
            </Step>
            <Step n={4} title={t("dash.int.stripe4")}>
              <p>{t("dash.int.stripe4Text")}</p>
            </Step>
            <Step n={5} title={t("dash.int.stripe5")}>
              <p>{t("dash.int.stripe5Text")}</p>
            </Step>
          </ol>
          {tests("stripe")}
        </div>
      ),
    },
    {
      id: "woocommerce",
      label: "WooCommerce",
      icon: <ShoppingCart className="size-4" aria-hidden />,
      content: (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ol>
            <Step n={1} title={t("dash.int.woo1")}>
              <p>{t("dash.int.woo1Text")}</p>
            </Step>
            <Step n={2} title={t("dash.int.wooMeta")}>
              <p>{t("dash.int.wooMetaText")}</p>
              <Snippet code={wooSnippet} />
            </Step>
            <Step n={3} title={t("dash.int.webhookStep")}>
              <p>{t("dash.int.woo2Text")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {[t("dash.int.wooTopicCreated"), t("dash.int.wooTopicUpdated")].map((e) => (
                  <li key={e}>
                    <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink">{e}</code>
                  </li>
                ))}
              </ul>
              <CopyField value={hookUrl} label={t("dash.int.webhookUrl")} />
            </Step>
            <Step n={4} title={t("dash.int.woo3")}>
              <p>{t("dash.int.woo3Text")}</p>
            </Step>
          </ol>
          {tests("woocommerce")}
        </div>
      ),
    },
    {
      id: "shopify",
      label: "Shopify",
      icon: <ShoppingBag className="size-4" aria-hidden />,
      content: (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ol>
            <Step n={1} title={t("dash.int.shopify1")}>
              <p>{t("dash.int.shopify1Text")}</p>
            </Step>
            {webhookStep(2, t("dash.int.shopify2Text"))}
            <Step n={3} title={t("dash.int.shopify3")}>
              <p>{t("dash.int.shopify3Text")}</p>
            </Step>
          </ol>
          {tests("shopify")}
        </div>
      ),
    },
    {
      id: "generic",
      label: t("dash.int.tabGeneric"),
      icon: <Webhook className="size-4" aria-hidden />,
      content: (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ol>
            {webhookStep(1, t("dash.int.generic1Text"))}
            <Step n={2} title={t("dash.int.generic2")}>
              <p>{t("dash.int.generic2Text")}</p>
              {samples("generic").map((x) => (
                <div key={x.id} className="space-y-1">
                  <p dir="ltr" className="text-start font-mono text-xs text-ink">
                    {x.title}
                  </p>
                  <Snippet code={typeof x.body === "string" ? x.body : JSON.stringify(x.body, null, 2)} />
                </div>
              ))}
            </Step>
          </ol>
          {tests("generic")}
        </div>
      ),
    },
    {
      id: "api",
      label: t("dash.int.tabApi"),
      icon: <Terminal className="size-4" aria-hidden />,
      content: (
        <ol>
          <Step n={1} title={t("dash.int.api1")}>
            <p>{entitlements.allowApi ? t("dash.int.api1Text") : t("dash.api.upgrade")}</p>
            <ButtonLink href="/dashboard/api-keys" size="sm" variant="outline">
              {entitlements.allowApi ? t("dash.int.api1Cta") : t("dash.banner.cta")}
            </ButtonLink>
          </Step>
          <Step n={2} title={t("dash.int.api2")}>
            <p>{t("dash.int.api2Text")}</p>
            <Snippet code={curl} />
          </Step>
          <Step n={3} title={t("dash.int.api3")}>
            <p>{t("dash.int.api3Text")}</p>
            <Snippet code={curlLead} />
          </Step>
        </ol>
      ),
    },
    {
      id: "javascript",
      label: "JavaScript",
      icon: <Braces className="size-4" aria-hidden />,
      content: (
        <ol>
          <Step n={1} title={t("dash.int.js1")}>
            <p>{t("dash.int.js1Text")}</p>
            <Snippet code={jsSignup} />
          </Step>
          <Step n={2} title={t("dash.int.js2")}>
            <p>
              {t("dash.int.js2Text")}{" "}
              {s.allowClientConversions ? (
                <Badge tone="success">{t("dash.int.jsOn")}</Badge>
              ) : (
                <Link href={`${programPath(program.id, "settings")}#tracking`} className="font-medium text-primary hover:underline">
                  {t("dash.int.jsOff")}
                </Link>
              )}
            </p>
            <Snippet code={jsConvert} />
          </Step>
        </ol>
      ),
    },
  ];

  return (
    <>
      {query.created ? <RefreshOnce cleanUrl={programPath(program.id, "integrations")} /> : null}
      <DashHeader
        title={t("dash.nav.integrations")}
        description={t("dash.int.subtitle")}
        actions={
          setup.scriptInstalled ? (
            <Badge tone="success" className="h-8 px-3 text-sm">
              <CircleCheck className="size-4" aria-hidden />
              {t("dash.int.installed")}
            </Badge>
          ) : (
            <Badge tone="warning" className="h-8 px-3 text-sm">
              <Clock className="size-4" aria-hidden />
              {t("dash.int.waiting")}
            </Badge>
          )
        }
      />
      {query.created ? (
        <Alert tone="success" className="mb-6" title={t("dash.int.createdTitle", { name: program.name })}>
          {t("dash.int.createdText")}
        </Alert>
      ) : null}

      <Panel className="mb-6" title={t("dash.int.step1")} description={t("dash.int.step1Text", { domain: program.domain })}>
        <div className="space-y-5">
          <CopyField value={snippet} label={t("dash.int.snippet")} multiline />
          <div className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm ${setup.scriptInstalled ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-line bg-paper"}`}>
            {setup.scriptInstalled ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{setup.scriptInstalled ? t("dash.int.verified") : t("dash.int.notVerified")}</p>
              <p className="mt-0.5 text-muted">
                {setup.lastClickAt ? t("dash.int.lastClick", { when: formatRelative(setup.lastClickAt, locale.code) }) : t("dash.int.testHint")}
              </p>
              <p dir="ltr" className="mt-2 flex items-center gap-2 text-start">
                <a href={testLink} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono text-[12px] text-primary hover:underline">
                  {testLink}
                </a>
                <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden />
              </p>
            </div>
          </div>
          <details className="group rounded-lg border border-line">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
              <Code2 className="size-4 text-muted" aria-hidden />
              {t("dash.int.options")}
            </summary>
            <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
              <ul className="space-y-2">
                {attrs.map(([name, text]) => (
                  <li key={name} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                    <code dir="ltr" className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">
                      {name}
                    </code>
                    <span className="text-muted">{text}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <p className="text-xs text-muted">
                  {t("dash.int.publicKey")}{" "}
                  <code dir="ltr" className="font-mono text-ink">
                    {program.publicKey}
                  </code>
                </p>
                <ActionButton action={regenerateKeyAction} fields={{ program_id: program.id }} variant="ghost" confirmText={t("dash.int.keyRegenerateConfirm")}>
                  <RefreshCw aria-hidden />
                  {t("dash.int.keyRegenerate")}
                </ActionButton>
              </div>
            </div>
          </details>
        </div>
      </Panel>

      <Panel
        id="connect"
        className="mb-6 scroll-mt-20"
        title={t("dash.int.step2")}
        description={t("dash.int.step2Text")}
        padded={false}
        actions={
          <ActionButton action={regenerateWebhookAction} fields={{ program_id: program.id }} variant="ghost" confirmText={t("dash.int.regenerateConfirm")}>
            <RefreshCw aria-hidden />
            {t("dash.int.regenerate")}
          </ActionButton>
        }
      >
        <div className="border-b border-line px-5 py-4">
          <p className="mb-1.5 text-xs font-medium text-muted">{t("dash.int.webhookUrl")}</p>
          <CopyField value={hookUrl} label={t("dash.int.webhookUrl")} />
          <p className="mt-1.5 text-xs text-muted">
            {setup.serverConnected ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CircleCheck className="size-3.5" aria-hidden />
                {t("dash.int.connected")}
              </span>
            ) : (
              t("dash.int.webhookHint")
            )}
          </p>
          <details className="mt-3 rounded-lg border border-line" open={program.hasWebhookSecret}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("dash.int.secretTitle")}</summary>
            <div className="space-y-2 border-t border-line px-3 py-3">
              <p className="text-xs text-muted">{t("dash.int.secretHint")}</p>
              <WebhookSecretForm programId={program.id} hasSecret={program.hasWebhookSecret} />
            </div>
          </details>
        </div>
        <GuideTabs tabs={tabs} label={t("dash.int.guides")} />
      </Panel>

      <Panel title={t("dash.int.step3")} description={t("dash.int.step3Text")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <CopyField value={portalUrl} label={t("dash.aff.portalUrl")} className="flex-1" />
          <ButtonLink href={`${programPath(program.id, "affiliates")}#invite`} variant="outline" className="shrink-0">
            {t("dash.aff.invite")}
          </ButtonLink>
        </div>
      </Panel>
    </>
  );
}
