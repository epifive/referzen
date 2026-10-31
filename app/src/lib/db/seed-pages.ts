/**
 * Default content pages created on install. Buyers edit them from
 * Admin → Pages. `{site_name}` and `{site_email}` are replaced when rendered.
 * They are a starting point, not legal advice: buyers should adapt them to their
 * business and the laws that apply to them.
 */
export const DEFAULT_PAGES = [
  {
    slug: "about",
    title: "About Us",
    metaDescription: "{site_name} helps SaaS companies and online stores run their own affiliate and referral programs: tracking, commissions, payouts and a branded affiliate portal.",
    content: `## Who we are

{site_name} is affiliate and referral program software for SaaS products and online stores. Create a program, invite your customers, fans and partners, and reward them for every sale they send your way.

## What we believe

- **Your best marketers are your customers.** People trust a recommendation from someone they know more than any ad.
- **Partners deserve clarity.** Every affiliate gets their own portal with their link, their numbers and their earnings, so nobody has to ask "did my sale count?".
- **Paying should be easy.** Commissions are approved after your refund window and paid in batches with one CSV file.
- **Simple, fair commissions.** One clear commission for every customer an affiliate refers, with optional recurring commissions for subscriptions.

## Works with the tools you already use

Stripe, WooCommerce and Shopify webhooks, a tiny JavaScript snippet for any website, and a REST API for everything else.

## Who uses {site_name}

SaaS founders, online shops, course creators, agencies and anyone who wants customers and partners to spread the word.

## Contact

Questions or ideas? [Get in touch](/contact) — we read every message.`,
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    metaDescription: "How {site_name} handles the data of its customers, their affiliates and the visitors of websites that use {site_name}.",
    content: `## Overview

This Privacy Policy explains how {site_name} ("we", "us") handles information. We deal with three groups of people:

1. **Our customers** ("merchants") — people who create an account to run referral programs.
2. **Affiliates** — people who join a merchant's program through its affiliate portal.
3. **Referred visitors and customers** — people who click an affiliate's link or buy from a merchant.

We collect only what is needed to credit referrals and pay commissions.

## Information about merchants

When you create an account we store your name, email address and a securely hashed password, plus what you set up: programs, commission rules, marketing assets, API keys and alert channels (for example a Slack webhook address).

If you buy a plan, payments are handled by the payment provider you choose. We receive a confirmation and the amount paid; we never see or store full card numbers.

## Information about affiliates

When you join a program we store your name, email address, a securely hashed password, your referral code and the payout details you enter (for example your PayPal email or bank account). This information is shared with the merchant who runs the program, because they review applications and pay your commissions. We also store your clicks, referrals, commissions and payouts.

## Information about referred visitors and customers

When someone opens a referral link, the merchant's website loads our small tracking script. The script:

- sets a **first-party cookie named \`rz_ref\`** on the merchant's own website, plus a copy in the browser's local storage, holding a random referral token. It lasts for the program's attribution window (60 days by default, set by the merchant, at most 365 days) and is used only to credit the right affiliate;
- sends us the referral code from the link, the landing page address, the referring website, an optional campaign id chosen by the affiliate and the browser's user agent.

From the request we also record the visitor's country (when the hosting platform provides it) and the device type (desktop, mobile or tablet).

**What we do not store:** the IP address. To spot duplicate and fraudulent clicks we keep a one-way hash of the IP address, user agent and a salt that changes every day, which cannot be turned back into an IP address. Raw clicks are deleted after 90 days; only daily totals are kept.

When a referred visitor signs up or buys, the merchant's systems (for example Stripe, WooCommerce, Shopify or the merchant's own server) send us what is needed to credit the affiliate: an order or payment id, the amount and currency, a customer or subscription id and the customer's email address. Merchants can choose to store customer emails as a one-way hash only. We never receive card numbers.

## Who is responsible

Each merchant decides to run a referral program with {site_name} and which data to send. For the data of their affiliates, visitors and customers we act on the merchant's behalf, as a service provider (processor). Merchants are responsible for informing their visitors and customers, for example in their own privacy policy, for showing a cookie notice or asking for consent where the law requires it before the \`rz_ref\` cookie is set, and for following the other laws that apply to them.

## Cookies on this website

We only use the cookies needed to run this website: one keeps you signed in (merchant dashboard or affiliate portal) and one remembers your language. Your theme and cookie notice choices are saved in your browser's local storage. We don't use advertising cookies.

## Sharing

We don't sell data and don't share it with advertisers. We only share what is needed with the services that help us run {site_name} (hosting, email delivery, payments) and, for affiliates, with the merchant whose program they joined.

## How long we keep data

Account, program and commission data is kept while the account exists, because merchants need their payout history. When a merchant deletes a program or their account, its affiliates, clicks, referrals and commissions are deleted too.

## Security

Passwords are hashed, connections are encrypted and access to our servers is restricted. No system is perfectly secure, but we work hard to protect your data.

## Your rights

You can see and change your details at any time from your account page or affiliate portal. Affiliates and customers who have a question about a program should contact the merchant who runs it first; we will help the merchant answer.

## Changes

We may update this policy. For important changes we will let customers know by email.

## Contact

For privacy questions contact us at {site_email}.`,
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    metaDescription: "The terms that apply when you use {site_name}.",
    content: `## Acceptance

By creating an account, joining a program or using {site_name} you agree to these terms. If you use {site_name} for a company, you confirm that you may accept these terms on its behalf.

## Your account

Keep your login details and API keys safe. You are responsible for everything done with your account.

## Merchants

- Only run programs for products and websites you own or manage, and only for lawful products and services.
- Publish clear program terms and pay the commissions you promise. {site_name} calculates commissions and prepares payout files, but payments to affiliates are made by you and are your responsibility.
- Tell your visitors and customers that you run a referral program, and follow the laws that apply to your business.
- Programs must reward real referrals of real customers. Each affiliate earns only on the customers they referred themselves.

## Affiliates

- Promote programs honestly. Do not use spam, misleading ads, fake reviews, cookie stuffing or self-referrals.
- Each merchant sets the commission, hold period, minimum payout and terms of their own program, and may reject or reverse commissions for refunds, chargebacks or abuse.

## Acceptable use

You may not use {site_name} to:

- run "recruit to earn" or similar schemes, or programs that pay affiliates for signing up other affiliates;
- send spam or unsolicited messages, or promote programs with misleading claims, fake reviews or hidden links;
- inflate clicks or conversions artificially (cookie stuffing, bots, self-referrals that your program terms don't allow);
- promote anything illegal, or break the rules of the payment and e-commerce platforms you connect;
- attack, overload or try to get around the limits and security of the service.

We may suspend programs or accounts that break these rules.

## Plans, limits and payments

Plan limits — number of programs, affiliates and monthly conversions — are shown on the pricing page. When an account reaches its monthly conversion limit, new conversions may not be recorded until the next month or until you upgrade. Paid plans renew or expire according to the billing period you chose. You can change or cancel your plan at any time; already paid periods are not refunded unless the law requires it.

## Availability and accuracy

We work hard to keep {site_name} available and accurate, but referral tracking is never perfect: ad blockers, cleared cookies, other devices and private browsing can all cause a referral to be missed. The service is provided "as is", without warranties of any kind, and our liability is limited to the amount you paid us in the last 12 months.

## Changes

We may update these terms. We will let customers know about important changes; continued use after a change means you accept the new terms.

## Contact

Questions about these terms? Write to {site_email}.`,
  },
];
