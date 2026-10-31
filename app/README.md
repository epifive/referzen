# Referzen

Affiliate and referral program SaaS (in the style of Rewardful and FirstPromoter), built with
**Next.js 16**, **React 19** and **Tailwind CSS 4**. Merchants sign up, create referral programs
for their SaaS product or online store, add a tiny tracking script (`rz.js`, about 1.4 KB gzipped)
and connect Stripe, WooCommerce, Shopify, a generic JSON webhook or the REST API. Affiliates get a
branded portal (`/a/<slug>`) with their link, a link builder, stats, earnings, marketing assets and
payout details. Commissions are **single-tier** (an affiliate earns on the customers they referred),
percentage or fixed, optionally recurring (N months or lifetime), approved after a hold period and
paid in batches with a PayPal Payouts CSV or a bank CSV. Referzen never moves money itself.

Includes fraud flags, notifications (email, signed webhook, Slack, Discord, Microsoft Teams,
Telegram), a daily merchant digest and weekly affiliate summary, paid plans with limits, four
payment gateways, a blog, multi-language/RTL and a full admin panel.

The complete guide is in [`documentation/index.html`](../documentation/index.html) (open it in a browser).

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:3000. You are redirected to the web installer at `/install`.
Choose **SQLite** for a zero-setup local database (Node.js 22.13+), or **MySQL** for production.
`npm run dev` also builds the tracking script `public/rz.js` first (`predev`).

To test tracking locally, create a program with the website `localhost` (or switch on "Count
clicks from localhost" in the program's tracking settings), put the snippet on a local page and
open it with `?ref=<affiliate code>`.

Background jobs run in "lazy mode" by default (after page views, clicks and webhooks, at most once
a minute). To run them without that activity, start the worker in a second terminal with the
secret from Admin → System → Scheduler:

```bash
CRON_SECRET=the-secret-from-admin npm run worker
```

## Production

```bash
npm install
npm run build        # builds public/rz.js (prebuild), then the Next.js app
npm start            # or: node server.js  (cPanel / Passenger / PM2)
```

Requirements: Node.js 20.9+ (22.13+ for the SQLite option), MySQL 5.7+/MariaDB 10.3+ (recommended)
or the built-in SQLite option, **HTTPS** (the script runs on merchants' HTTPS sites and payment
providers only send webhooks to https:// URLs), outbound HTTPS for alerts and SMTP for emails.

### Background jobs

Every "tick" runs these jobs within a time budget:

| Job | What it does |
| --- | --- |
| `approve-commissions` | Pending conversions past the program's hold period become approved (flagged self-referral / same-device conversions stay pending for review). Every 10 min. |
| `click-rollups` | Daily click summaries (`click_daily`) of finished UTC days; raw clicks are deleted after 90 days once summarised. Every 10 min. |
| `notifications` | Daily merchant digest and weekly affiliate summary (needs SMTP). Every 15 min. |
| `usage` | 80 % / 100 % of the plan's monthly conversions: email + alert channels. Every 15 min. |
| `housekeeping` | Expired sessions and reset links, alert log older than 90 days. Hourly. |

Something must start ticks:

| Method | How | Notes |
| ------ | --- | ----- |
| Lazy mode | On by default (Admin → Settings → Referrals) | Only while there is activity. Fine for testing. |
| Cron URL | `curl -fsS "https://your-site/api/cron/tick?key=SECRET"` every 1–5 minutes | cPanel, shared hosting, Vercel (external cron service; Vercel Hobby cron runs only daily). |
| Worker | `CRON_SECRET=… npm run worker` (calls the cron URL every 15 s) | VPS / Docker. |

The secret is `CRON_SECRET` (env) or a random value stored in the database and shown in
Admin → System → Scheduler. The cron URL also accepts `Authorization: Bearer SECRET` (as sent by
Vercel Cron).

- **PM2:** `ecosystem.config.cjs` starts the app (`referzen`) and the worker (`referzen-worker`).
- **Docker:** `docker-compose.yml` runs `app`, `worker` and MySQL 8.4.

> **Required:** set `CRON_SECRET` (12+ random characters, e.g. `openssl rand -hex 24`) before
> `pm2 start` or `docker compose up`. docker-compose refuses to start without it. The app ignores
> values shorter than 12 characters and the example value `change-me-to-a-long-random-string`
> (it then uses the secret stored in the database, so the worker gets `401`).

Without ticks, pending commissions are never approved, clicks are not summarised or pruned, and
no digests or usage emails are sent.

## How a sale is tracked

1. `rz.js` sees `?ref=CODE` → `POST /api/click` → a referral token in the first-party cookie
   `rz_ref` (+ localStorage) for the program's cookie days.
2. Optional lead: `referzen.signup()`, `POST /api/v1/referrals` or a generic `lead` event.
3. Payment: `POST /api/hooks/<webhook token>` (Stripe / WooCommerce / Shopify / generic) or
   `POST /api/v1/conversions` with the token → attributed (token → code → earlier
   subscription/customer → lead by customer id / email) → conversion, idempotent per
   (program, source, order id).
4. Pending for the hold period → approved by the job → due balance → payout batch → marked paid.
   Refunds ≥ 50 %, cancellations and disputes reverse unpaid conversions.

## Project structure

```
src/
  referral/                The contract, dependency-free:
    types.ts               Program settings + defaults, statuses, sources, fraud flags, tracker
                           payloads, REST API shapes, alert channel configs, AlertPayload
    normalize.ts           Validation (domains, slugs, codes, settings, payout details), money
                           helpers, computeCommission() and the recurring rule
    csv.ts                 PayPal Payouts / bank / full payout CSV builders
    format.ts              Display helpers
  tracker/                 Source of the tracking script (bundled to public/rz.js)
    index.ts               Click, cookie, hidden inputs, Stripe Payment Links, Shopify cart
                           attribute, window.referzen API (ready, signup, convert)
    README.md              Snippet, data-* options, JS API, Stripe/WooCommerce/Shopify/generic/API
                           integration guide, first-party proxy
  app/(site)/              Public website: home, pricing, blog, pages, account, auth, checkout
  app/(dashboard)/         Merchant dashboard: programs, overview, affiliates, conversions (+ CSV
                           export), payouts (+ CSV files), marketing assets, integrations, program
                           settings, alert channels, API keys
  app/a/[slug]/            Affiliate portal: landing, sign-up, login, reset, overview, links,
                           earnings, assets, settings
  app/admin/               Admin panel (incl. Programs and the System → Scheduler card)
  app/install/             Web installer
  app/actions/             Server actions (auth, billing, dashboard/*, portal/*)
  app/api/click|referral|convert/   Tracking endpoints used by rz.js (POST, CORS open)
  app/api/hooks/[token]/   Incoming conversion webhooks of a program
  app/api/v1/              REST API: referrals, conversions (+ /refund), affiliates
  app/api/cron/tick/       Cron URL: runs one scheduler tick (secret required)
  app/api/payments/        Payment gateway callbacks for the platform's own plans
  lib/tracking.ts          Click / lead / browser-conversion handlers: host check, bots,
                           rate limits, duplicate clicks
  lib/salts.ts             Daily-rotating salt and the anonymous visitor hash (no IPs stored)
  lib/attribution.ts       Referral event → lead / conversion / reversal; attribution order,
                           recurring window, fraud flags
  lib/conversions.ts       Idempotent conversions, reversal, approval, reopen
  lib/payouts.ts           Due balances, payout batches, mark paid, cancel, CSV rows
  lib/programs.ts          Programs (CRUD, slug / public key / webhook token lookups)
  lib/affiliates.ts        Affiliates (unique codes, portal passwords, status, overrides)
  lib/webhooks/            presets.ts (Stripe, WooCommerce, Shopify, generic parsers),
                           receive.ts (handler), verify.ts (signatures), samples.ts (test events)
  lib/jobs/                approve-commissions, click-rollups, notifications, usage, housekeeping
  lib/scheduler.ts         Ticks: lock, job order, time budget, cron secret
  lib/lazy-tick.ts         Lazy mode (tick after a response when none ran for a minute)
  lib/notify/              Merchant notifications and affiliate emails
  lib/alerts/              Alert channels (email, webhook, slack, discord, teams, telegram)
  lib/portal-*.ts          Portal sessions (cookie rz_aff, scoped to /a/<slug>), stats, data
  lib/api-v1.ts, api-keys.ts, api-guard.ts   REST API helpers, keys, auth + rate limit
  lib/usage.ts, plans.ts   Monthly conversion quota, plan entitlements
  lib/net/ssrf.ts          Private-address rules for outgoing webhook deliveries
  lib/i18n/messages.ts     Every interface string in English (source for translations)
  lib/db/migrations.ts     Database schema, indexes and default plans (run automatically)
scripts/build-widget.mjs   Bundles src/tracker into public/rz.js with esbuild (2 KB gzip budget)
scripts/worker.mjs         Worker: calls /api/cron/tick every WORKER_INTERVAL_SEC (15 s)
storage/                   Created at runtime: config.json, SQLite database, uploads
```

`public/rz.js` is generated and not committed. It is rebuilt by `predev`, `prebuild` and
`npm run widget:build`.

## Scripts

| Command                | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Build `rz.js`, then start the development server              |
| `npm run build`        | Build `rz.js`, then the production app                        |
| `npm start`            | Start the production server                                   |
| `npm run start:server` | Start via `server.js` (hosting panels, PM2)                   |
| `npm run worker`       | Run a scheduler tick every 15 s (needs `CRON_SECRET`)         |
| `npm run widget:build` | Rebuild only `public/rz.js` (prints raw and gzip size)        |
| `npm run lint`         | ESLint                                                        |
| `npm run typecheck`    | TypeScript check                                              |

## Extending

- **Payment provider preset** (e.g. Paddle): `WEBHOOK_PRESETS`, `detectPreset()`, a `mapX()`
  returning `ReferralEvent`s and a case in `mapWebhook()` in `src/lib/webhooks/presets.ts`;
  the name in `CONVERSION_SOURCES` (`src/referral/types.ts`, max 16 chars) and `SOURCES`
  (`receive.ts`); a signature case in `verify.ts`; a sample in `samples.ts`; the
  `dash.conv.source.*` message.
- **Alert channel:** `CHANNEL_TYPES`/`ChannelConfigByType` in `src/referral/types.ts`,
  `normalizeChannelConfig`/`channelProblem` in `src/referral/normalize.ts`, a sender in
  `src/lib/alerts/` using `describeAlert()` and `deliver()`, a case in `sendAlert()`, the form in
  `src/components/dashboard/channel-forms.tsx` and `dash.channels.*` messages.
- **Background job:** implement `Job` (`src/lib/jobs/index.ts`), throttle it with
  `isDue()`/`scheduleNext()` from `jobs/shared.ts`, and add it to `JOBS`.

Run `npm run typecheck && npm run build` and restart the app and the worker after changes.

## Dependencies note

`ua-parser-js` is pinned to version 1 (MIT). Do not upgrade to version 2: it is AGPL-3.0.

## Environment variables

Optional; the web installer writes `storage/config.json`. See `.env.example` for database
variables, `ADMIN_*`, `SITE_URL`, `STORAGE_DIR`, `TRUSTED_PROXY_HOPS`, `CRON_SECRET`, `DEMO_MODE`,
`DEMO_SEED`, `DEMO_AFFILIATE_EMAIL`/`DEMO_AFFILIATE_PASSWORD`, `CLICK_RATE_LIMIT_PER_MIN`,
`CLICK_PROXY_RATE_LIMIT_PER_MIN`, `WEBHOOK_RATE_LIMIT_PER_MIN` and `ALLOW_PRIVATE_WEBHOOKS`.
The worker also reads `WORKER_URL` and `WORKER_INTERVAL_SEC`.
