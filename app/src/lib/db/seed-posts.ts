/** Starter blog posts created on install (Admin → Blog). Markdown. */
export const DEFAULT_POSTS = [
  {
    slug: "launch-a-saas-affiliate-program",
    title: "How to launch an affiliate program for your SaaS",
    excerpt: "Your happiest customers already recommend you. An affiliate program turns those recommendations into a measurable channel. Here is how to launch one in an afternoon.",
    metaDescription: "A step-by-step guide to launching a SaaS affiliate program: choosing a commission, tracking referrals with Stripe, writing program terms, recruiting affiliates and paying them on time.",
    content: `## Why SaaS and affiliate programs fit so well

Software is easy to recommend: people who love a tool talk about it in reviews, tutorials, newsletters and team chats. An affiliate program gives those people a personal link and a reason to share it, and you only pay when a referral turns into a paying customer.

For a subscription business the economics are especially friendly. A customer who stays for two years is worth far more than their first invoice, so you can afford a commission that feels generous to a partner and still makes every referred customer profitable.

## Step 1: Pick one clear offer

Partners need to be able to explain your offer in one sentence. Good starting points for SaaS:

- **20–30 % recurring for 12 months.** The most common choice. It rewards partners for bringing customers who stay, and the cost is capped.
- **A fixed amount per new customer**, for example $50. Simple to promote when your plans are priced close together.

Pick one default for everyone. You can give your best partners a custom rate later.

## Step 2: Set your safety rails

Three settings protect you from paying for sales that don't stick:

1. **Hold period:** commissions stay pending for your refund window (30 days is typical) before they can be paid.
2. **Automatic reversals:** when Stripe reports a refund or a dispute, the matching commission is reversed.
3. **Minimum payout:** small balances roll over until they reach, say, $50, so you don't send dozens of tiny payments.

## Step 3: Install tracking

You need two pieces:

- A small script on your marketing site that notices the referral link (\`?ref=maya\`) and remembers it in a first-party cookie for your attribution window (60 days is a good default).
- A webhook from Stripe. Pass the referral to Stripe Checkout as \`client_reference_id\` or metadata, and every payment, renewal and refund of that customer is credited to the right affiliate automatically.

Before you invite anyone, create a test affiliate, click your own link and run a test payment. Seeing the conversion appear takes five minutes and saves a lot of support emails later.

## Step 4: Write short, honest program terms

Your terms should answer what partners will ask anyway: how much they earn, when they get paid, which payout methods you support and what isn't allowed. Common rules: no bidding on your brand name in search ads, no coupon sites, no spam and no self-referrals.

## Step 5: Recruit your first ten partners

Don't start with a public "join our affiliate program" page and wait. Start with people who already like you:

- customers who left a great review or keep recommending you in communities,
- newsletter writers and YouTubers in your niche,
- agencies and consultants who set your product up for their clients.

Send each a personal invitation with the link to your branded affiliate portal, a few ready-made banners and a short text they can paste.

## Step 6: Pay on time, every time

Pick a fixed payout day, for example the 5th of every month. Export the due commissions as a PayPal Payouts or bank CSV, send the payments, mark the batch as paid and let your affiliates know. Reliable payouts are the single best way to keep partners promoting you.

## What to measure

Watch clicks, conversions and revenue per affiliate. After three months you will know who your real partners are. Thank them with a higher rate, early access to features or a direct line to your team.`,
  },
  {
    slug: "recurring-vs-one-time-commissions",
    title: "Recurring vs one-time commissions: which should you offer?",
    excerpt: "Pay once per sale, or keep paying as long as the customer does? The answer depends on your pricing, your margins and the partners you want to attract.",
    metaDescription: "Recurring vs one-time affiliate commissions compared: how each works, the math behind them, when to cap recurring commissions and how refunds and hold periods fit in.",
    content: `## The two models in one sentence each

- **One-time:** the affiliate earns once, on the customer's first payment.
- **Recurring:** the affiliate earns on the first payment and on renewals, for a set number of months or for the customer's lifetime.

Either way, an affiliate earns only on the customers they personally referred. Keep it that simple: one partner, one customer, one clear commission.

## Let the numbers decide

Take a $49 per month plan and a 30 % commission:

| Model | Affiliate earns per customer | You pay |
| --- | --- | --- |
| One-time, 30 % of the first payment | $14.70 | once |
| Recurring for 12 months | up to $176.40 | over a year |
| Recurring for life | $14.70 every month | as long as the customer stays |

The one-time version is cheap, but $14.70 rarely motivates anyone to write a tutorial or record a video. The recurring version pays the affiliate more over time, and you pay it out of revenue you are actually receiving.

## When one-time commissions make sense

- **One-off purchases:** courses, templates, lifetime deals and physical products.
- **Annual plans paid upfront:** the first payment already contains a year of revenue.
- **Very high churn:** if most customers leave after a month or two, recurring commissions won't add much anyway.

A fixed amount per sale ("$50 for every new customer") is often the clearest one-time offer.

## When recurring commissions make sense

- **Monthly subscriptions:** the first invoice is small, the lifetime value is large.
- **Content partners:** bloggers and creators whose posts send customers for years want to share in that long tail.
- **Products with low churn:** the longer customers stay, the more a recurring offer is worth to a partner, and the more attractive your program looks next to others.

## Capped or lifetime?

Lifetime commissions are the strongest pitch, but they are a promise you keep for years. Most SaaS companies cap recurring commissions at **12 or 24 months**. It is easy to explain, still generous, and keeps the cost predictable as your customer base grows.

## Don't forget refunds and upgrades

- Use a **hold period** that matches your refund window, so commissions only become payable once a payment is final.
- Make sure **refunds and disputes reverse** the matching commission automatically. With Stripe webhooks this happens without any manual work.
- A percentage commission grows automatically when a referred customer upgrades. A fixed amount doesn't.

## Our suggestion

For most subscription products: **20–30 % recurring for 12 months**, a 30-day hold and a $50 minimum payout. Start there, look at the numbers after a quarter, and give your best partners a higher custom rate.`,
  },
  {
    slug: "stopping-affiliate-fraud",
    title: "Stopping affiliate fraud without scaring off good partners",
    excerpt: "Most affiliates are honest, but a few tricks show up in every program. Here is how to catch self-referrals, fake sales and refund abuse while keeping your real partners happy.",
    metaDescription: "How to prevent affiliate and referral fraud: self-referrals, same-browser purchases, duplicate customers, refund abuse and cookie stuffing, and the settings that stop them.",
    content: `## The good news first

The vast majority of affiliates are honest people who like your product. Fraud prevention should be invisible to them: no extra paperwork, no delayed payouts without a reason. The trick is to let rules catch the obvious cases and hold the questionable ones for a human decision.

## 1. Self-referrals

**What it looks like:** someone signs up as an affiliate and buys through their own link to earn a commission on their own purchase.

**How to catch it:** compare the buyer with the affiliate. A conversion where the customer's email matches the affiliate's email should be flagged, not paid automatically. Your program terms should say clearly whether self-referrals are allowed (usually they are not).

## 2. Purchases from the affiliate's own browser

**What it looks like:** the affiliate uses a second email address, but buys from the same computer they use to check their affiliate dashboard.

**How to catch it:** compare the click that led to the sale with the browser the affiliate signs in from. A match is a strong signal. This works with a daily-salted, one-way visitor hash, so you never need to store anyone's IP address.

## 3. Customers who were already referred

**What it looks like:** a customer who was credited to one affiliate shows up again through another affiliate's link, sometimes because a coupon site or a browser extension inserted itself at checkout.

**How to catch it:** flag conversions of a customer who is already credited to a different affiliate, and decide case by case.

## 4. Refund and chargeback abuse

**What it looks like:** buy through a link, collect the commission, then ask for a refund.

**How to stop it:** two settings solve this completely:

- a **hold period** that matches your refund window, so commissions stay pending until the payment is final, and
- **automatic reversals** when your payment platform reports a refund or a dispute.

## 5. Cookie stuffing and click spam

**What it looks like:** hidden links, pop-unders or bots that drop referral cookies on visitors who never chose to click.

**How to catch it:** watch for affiliates with lots of clicks but almost no conversions, clicks from unexpected websites, and many repeated clicks from the same visitor. De-duplicating repeated clicks keeps your conversion rates honest.

## 6. Spammy or misleading promotion

**What it looks like:** spam emails, fake reviews, ads bidding on your brand name, or claims you would never make.

**How to stop it:** write the rules down in your program terms, require affiliates to accept them at sign-up, and review new applications by hand for the first few weeks. It takes a minute per affiliate and keeps your program clean from day one.

## Put it together

- Flagged conversions are **held**, never approved automatically.
- Clean conversions are **approved automatically** after the hold period.
- You review the few flagged ones and approve or reverse them.

That way honest partners are paid on time, and the rare bad actor never sees a payout.`,
  },
];
