# Referzen tracking: integration guide

Referzen attributes sales to affiliates in three steps:

1. **Click**: a visitor opens an affiliate link (`https://your-site.com/?ref=jane`). The tracking
   script `rz.js` records the click and keeps a **referral token** in a first-party cookie
   (`rz_ref`) for the program's attribution window (cookie days).
2. **Lead** (optional): when the visitor signs up, you tell Referzen who they are (email /
   customer id). Later payments of that customer are attributed even without the cookie.
3. **Conversion**: your payment provider (Stripe, WooCommerce, Shopify) or your server reports
   the payment to the program's webhook URL or the REST API, with the referral token. Refunds
   and disputes reverse the commission automatically.

Commissions are single-tier: an affiliate earns on the customers they referred, nothing else.

---

## 1. The tracking script

Add it to every page of your website (in `<head>`), before the closing `</head>` tag:

```html
<script async src="https://PLATFORM/rz.js" data-program="PUBLIC_KEY"></script>
```

`PLATFORM` is the address of this Referzen installation and `PUBLIC_KEY` the program's key
(Dashboard → Program → Integrations). The script is about 1.5 KB (gzip), sets no cookie for
visitors who did not come from an affiliate link, and never throws errors into your page.

| Attribute | Meaning |
| --- | --- |
| `data-program` | Program key (required). `data-key` works too. |
| `data-param` | Extra query parameters that carry the referral code, comma-separated (`aff,partner`). `ref` and `via` are always read. Use it when you changed the program's referral parameters. |
| `data-domain` | Cookie domain, e.g. `.example.com`, to share the referral between `www.example.com` and `app.example.com`. |
| `data-api` | Base URL of a first-party proxy (see below). Default: `https://PLATFORM/api`. |
| `data-respect-dnt` | Do not track visitors whose browser sends "Do Not Track". |

The page must be on the program's website (its domain, a subdomain of it or one of the extra
domains in the program settings). Clicks from other websites are refused. To test on
`localhost`, enable "Allow localhost" in the program settings.

### What the script does

When the URL contains `?ref=CODE` (or `?via=CODE`, or your `data-param`), the script sends the
click to `/api/click`. If the code belongs to an approved affiliate, it stores the returned
referral token:

- cookie `rz_ref=<token>` (path `/`, `SameSite=Lax`, `Secure` on https, `max-age` = cookie days)
- a `localStorage` copy (`rz_ref`), which restores the cookie if it is deleted early

Optional `?sub=` / `?sub_id=` values are saved as the campaign (sub id) of the click. The URL is
left as it is.

Then, on every page while the referral is valid, it hands the token to your checkout:

- fills every `<input name="referzen">` with the token,
- adds that hidden input to forms marked `<form data-referzen>`,
- appends `client_reference_id=<token>` to **Stripe Payment Links** (`https://buy.stripe.com/…`),
- on **Shopify** stores the token as the cart attribute `referzen`.

### JavaScript API

```html
<script>
  // Optional stub: lets you call referzen(...) before rz.js has loaded.
  window.referzen = window.referzen || function () { (referzen.q = referzen.q || []).push(arguments); };
</script>
```

```js
referzen.referral          // the referral token, or null (not referred)
referzen.code              // the affiliate's referral code, or null
referzen.ready(function (r) { console.log(r.referral); });   // runs after the click was recorded

// A referred visitor signed up: creates a lead (returns a Promise<boolean>).
referzen.signup({ email: "customer@example.com", customerId: "cus_123" });

// Client-side conversion (only when "Accept client-side conversions" is on in the program
// settings; flagged lower trust because anyone can call it). Prefer webhooks.
referzen.convert({ amount: 49.9, currency: "USD", orderId: "1001", email: "customer@example.com" });

// With the stub, the same calls work before the script loaded:
referzen("ready", function (r) { /* … */ });
referzen("signup", { email: "customer@example.com" });
```

---

## 2. Stripe

Create a webhook endpoint in **Stripe → Developers → Webhooks** with the program's webhook URL
(`https://PLATFORM/api/hooks/<token>`) and select these events:

- `checkout.session.completed` (and `checkout.session.async_payment_succeeded` for delayed methods)
- `invoice.paid` (subscription renewals)
- `charge.refunded` and `charge.dispute.created` (reversals)
- `payment_intent.succeeded` only if you charge without Checkout (see below)

Optionally paste the endpoint's **signing secret** (`whsec_…`) in the program's integration
settings: requests without a valid `Stripe-Signature` are then refused. Several endpoints (or
an old and a new secret while rotating)? Save all of them separated by commas: a signature made
with any of them is accepted.

### Stripe Checkout

Pass the token as `client_reference_id` when you create the Checkout Session (read it from the
`rz_ref` cookie on your server, or send `referzen.referral` from the browser):

```js
// Node.js
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: "price_123", quantity: 1 }],
  client_reference_id: req.cookies.rz_ref, // or metadata: { referzen: req.cookies.rz_ref }
  success_url: "https://example.com/thanks",
});
```

```php
// PHP
$session = \Stripe\Checkout\Session::create([
  'mode' => 'payment',
  'line_items' => [['price' => 'price_123', 'quantity' => 1]],
  'client_reference_id' => $_COOKIE['rz_ref'] ?? null,
  'success_url' => 'https://example.com/thanks',
]);
```

### Stripe Payment Links

Nothing to do: `rz.js` adds `client_reference_id` to links to `buy.stripe.com` on your pages.

### Subscriptions (Stripe Billing)

The first payment is recorded from `checkout.session.completed` (the matching
`invoice.paid` with billing reason `subscription_create` is recognised and not counted twice).
Each renewal `invoice.paid` is attributed through the subscription / customer of the first
payment, and earns while the program's recurring rule allows it (first payment only, N months,
or lifetime). A checkout with a free trial (nothing paid yet) records the customer as a lead;
the first paid invoice after the trial becomes the conversion.

If you create subscriptions without Checkout, put the token in the subscription metadata
(`metadata: { referzen: token }`) or record a lead with the customer id first
(`referzen.signup({ customerId: "cus_…" })` or `POST /api/v1/referrals`).

### Payments without Checkout

Add `metadata: { referzen: token }` to the PaymentIntent and select `payment_intent.succeeded`.
Charges and payment intents without that metadata are ignored (Checkout and invoices are
tracked by their own events).

### Refunds and disputes

`charge.refunded` (or `refund.created`) reverses the commission when at least half of the
payment was refunded (smaller partial refunds keep it). `charge.dispute.created` always reverses
it. Subscription payments are recorded under the invoice id; the invoice's payment intent and
charge are stored with the conversion, so refunds and disputes of renewals find it too.

A commission that was already paid out is reversed as well: its amount is recorded as a negative
adjustment and deducted from the affiliate's next payout.

### Coupons

Stripe's webhook events don't include coupon or promotion codes, only ids. To credit an affiliate's
coupon, pass the code in the Checkout Session metadata (`metadata: { coupon: "JANE10" }`).

---

## 3. WooCommerce

1. Add the tracking script to your theme (or with a "header scripts" plugin).
2. Save the referral token in the order. Add this snippet to your theme's `functions.php` or a
   code-snippets plugin:

```php
// Referzen: remember the affiliate referral of the order.
add_action( 'woocommerce_checkout_create_order', function ( $order ) {
    if ( ! empty( $_COOKIE['rz_ref'] ) && preg_match( '/^[A-Za-z0-9]{16,32}$/', $_COOKIE['rz_ref'] ) ) {
        $order->update_meta_data( '_referzen', sanitize_text_field( $_COOKIE['rz_ref'] ) );
    }
} );
```

For the block checkout (WooCommerce 8.3+) also add:

```php
add_action( 'woocommerce_store_api_checkout_update_order_from_request', function ( $order ) {
    if ( ! empty( $_COOKIE['rz_ref'] ) && preg_match( '/^[A-Za-z0-9]{16,32}$/', $_COOKIE['rz_ref'] ) ) {
        $order->update_meta_data( '_referzen', sanitize_text_field( $_COOKIE['rz_ref'] ) );
    }
} );
```

3. **WooCommerce → Settings → Advanced → Webhooks → Add webhook**: topic "Order created" and a
   second one for "Order updated", delivery URL = the program's webhook URL, API version WP REST
   API v3. A secret is optional: if you set one, paste the same value as the program's signing
   secret.

Orders are recorded when they are `processing` or `completed`; `refunded` / `cancelled` orders
(or refunds of at least half) reverse the commission. Orders without the token are attributed
by the billing email when the customer was recorded as a lead before, then by a coupon code
(`coupon_lines`) that you assigned to an affiliate. WooCommerce Subscriptions renewal orders of
the same customer count as renewals.

---

## 4. Shopify

1. **Online Store → Themes → Edit code → `theme.liquid`**: add the tracking script before
   `</head>`. On Shopify it stores the referral token as the cart attribute `referzen`
   automatically. Manual version (if you load the script elsewhere):

```html
<script>
  referzen("ready", function (r) {
    if (!r.referral) return;
    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: { referzen: r.referral } })
    });
  });
</script>
```

2. **Settings → Notifications → Webhooks → Create webhook**: "Order payment" (`orders/paid`)
   and "Refund create" (`refunds/create`), format JSON, URL = the program's webhook URL.
   Optionally paste the webhook signing secret shown on that page as the program's signing
   secret.

The order's cart attribute (`note_attributes.referzen`) identifies the referral. Orders without
it are matched by a `?ref=CODE` on the order's landing page (the program's referral parameters,
then `ref`, `via`, `aff`, `affiliate`), then by the customer email of an earlier lead, then by a
discount code (`discount_codes`) that you assigned to an affiliate.

---

## 5. Any other platform: generic webhook

POST JSON to the program's webhook URL from your backend or a no-code tool (Zapier, Make, n8n):

```json
{ "event": "payment", "id": "INV-1001", "amount": 49.90, "currency": "USD",
  "referral": "<rz_ref cookie>", "email": "customer@example.com",
  "customer": "cust_42", "subscription": "sub_7" }
```

```json
{ "event": "refund", "id": "INV-1001", "amount": 49.90, "reason": "Customer cancelled" }
```

```json
{ "event": "lead", "referral": "<rz_ref cookie>", "email": "customer@example.com", "customer": "cust_42" }
```

`amount` is in major units. Send several events as an array or `{ "events": [...] }` (max 50).
`id` makes payments idempotent: repeating the same id records nothing new. Add `"coupon": "JANE10"`
to credit the affiliate a coupon code belongs to. Signature (required once a signing secret is
saved): `X-Referzen-Signature: sha256=<hex HMAC-SHA256 of the body with the program's signing secret>`.

Paused programs, and programs of a suspended account, answer `403` and record nothing.

The response tells you what happened:

```json
{ "ok": true, "preset": "generic", "created": 1, "duplicates": 0, "reversed": 0, "leads": 0,
  "ignored": 0, "rejected": 0,
  "results": [{ "kind": "payment", "id": "INV-1001", "status": "created", "conversion_id": 12,
                "affiliate": "jane", "attributed_by": "token", "amount_cents": 4990,
                "commission_cents": 998, "currency": "USD", "nth": 1, "conversion_status": "pending" }] }
```

Payments that are not referred answer `200` with `"status": "ignored"` and a `reason`.

---

## 6. REST API

Create an API key in the dashboard (API keys; plans with API access). Send it as
`Authorization: Bearer <key>`. Amounts are in major units.

| Method | Path | Body / query |
| --- | --- | --- |
| `POST` | `/api/v1/referrals` | `{ program_id, referral \| affiliate_code, email \| customer_id }` → 201 lead |
| `GET` | `/api/v1/programs` | → your programs: `id, name, slug, currency, status, portal_url` |
| `POST` | `/api/v1/conversions` | `{ program_id, order_id, amount, currency?, referral?, affiliate_code?, customer_id?, subscription_id?, email?, coupon?, occurred_at? }` → 201 conversion, 200 duplicate or ignored |
| `POST` | `/api/v1/conversions/refund` | `{ program_id, order_id, amount?, reason? }` → 200 reversed |
| `GET` | `/api/v1/conversions` | `?program_id=&status=&from=&to=&affiliate_id=&limit=&offset=` |
| `GET` | `/api/v1/affiliates` | `?program_id=&status=&search=&limit=&offset=` |

```bash
curl -X POST https://PLATFORM/api/v1/conversions \
  -H "Authorization: Bearer $REFERZEN_KEY" -H "Content-Type: application/json" \
  -d '{"program_id":1,"order_id":"1001","amount":49.9,"currency":"USD","referral":"'"$RZ_REF"'"}'
```

Errors are JSON `{ "error": "…" }`: 400 invalid input, 401 missing / invalid key, 403 no API
access, monthly conversion limit reached or program paused, 404 unknown program, 429 more than
600 requests a minute.

Commissions are always in the program currency. A payment in another currency is recorded with
the flag `currency_mismatch` and stays pending: approve it in the dashboard with the commission.

Attribution order for every source: referral token (inside the attribution window) → affiliate
code → the subscription / customer of an earlier conversion (renewals) → a lead with the same
customer id → a lead with the same email → a coupon code assigned to an affiliate
(case-insensitive). Only approved affiliates earn.

---

## 7. First-party proxy (optional)

Some ad blockers block third-party tracking scripts. Serve the script and the API from your own
domain, e.g. with Nginx:

```nginx
location = /rz.js { proxy_pass https://PLATFORM/rz.js; }
location /rz/ {
    proxy_pass https://PLATFORM/api/;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

```html
<script async src="/rz.js" data-program="PUBLIC_KEY" data-api="/rz"></script>
```

Keep `X-Forwarded-For` so duplicate clicks are still recognised per visitor.

---

## Fraud checks

- Clicks from bots, link previews and prefetches are dropped; repeated clicks of the same
  visitor on the same link within 30 minutes are counted as duplicates (not unique clicks).
- Conversions are flagged **self_referral** when the customer's email is the affiliate's own
  email, and **same_visitor** when the click came from the affiliate's own browser and network
  (portal sign-in the same day). Client-side conversions are flagged **client_side**. A new first
  purchase of a customer who was already credited to another affiliate is flagged
  **duplicate_customer**. Self-referral, same-visitor, duplicate-customer and **currency_mismatch**
  conversions are never approved automatically, even with a 0-day refund window: they wait for
  the merchant's review.
- Visitor hashes use a salt that changes every day: no IP address is stored.
