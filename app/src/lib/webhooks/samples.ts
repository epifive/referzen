/**
 * Example incoming webhook payloads (trimmed versions of what each provider sends), used by
 * the Integrations page ("Send test event"), the docs and the tests. `expect` describes what
 * Referzen does with the sample.
 *
 * The samples carry SAMPLE_REFERRAL_TOKEN as the referral token: sent as they are, they are
 * acknowledged with { ok: true, ignored: 1, reason: "No matching referral…" } (or "No conversion
 * matches this refund"). Use withSampleReferral() to replace it with a real token (from a test
 * click) and get a recorded conversion.
 *
 * No imports: safe to use from client and server components.
 */

export interface WebhookSample {
  id: string;
  preset: "stripe" | "woocommerce" | "shopify" | "generic";
  title: string;
  description: string;
  /** Request headers the provider sends that matter for detection. */
  headers: Record<string, string>;
  contentType: "application/json" | "application/x-www-form-urlencoded";
  /** Parsed body (JSON) or a URL-encoded string for form posts. */
  body: unknown;
  /** What the sample does when its referral token is valid (English). */
  expect: string;
}

/** Placeholder referral token (the format of a real rz_ref cookie value: 24 letters / digits). */
export const SAMPLE_REFERRAL_TOKEN = "SampLeReFerraLT0ken12345";

/** Unix time used by the samples (2026-10-14 08:20 UTC). */
const T = 1792146000;

export const STRIPE_CHECKOUT_SAMPLE: WebhookSample = {
  id: "stripe-checkout",
  preset: "stripe",
  title: "Stripe: checkout.session.completed (subscription)",
  description:
    "Stripe → Developers → Webhooks → add this URL and select checkout.session.completed, invoice.paid, charge.refunded and charge.dispute.created. Pass the visitor's referral token as client_reference_id (window.referzen.referral) when you create the Checkout Session.",
  headers: {},
  contentType: "application/json",
  body: {
    id: "evt_1QzCheckout0001",
    object: "event",
    api_version: "2025-09-30.clover",
    created: T,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_a1B2c3D4e5F6",
        object: "checkout.session",
        mode: "subscription",
        client_reference_id: SAMPLE_REFERRAL_TOKEN,
        amount_total: 4900,
        currency: "usd",
        created: T - 40,
        customer: "cus_SampleCustomer01",
        customer_details: { email: "emma.johnson@example.com", name: "Emma Johnson" },
        subscription: "sub_SampleSubscription01",
        invoice: "in_SampleInvoice0001",
        payment_status: "paid",
        status: "complete",
        metadata: {},
      },
    },
  },
  expect: "Records a $49.00 conversion (payment 1 of the subscription) for the affiliate of the referral token.",
};

export const STRIPE_INVOICE_SAMPLE: WebhookSample = {
  id: "stripe-invoice-renewal",
  preset: "stripe",
  title: "Stripe: invoice.paid (renewal)",
  description: "Subscription renewals are matched by the subscription / customer of the first payment and earn while the program's recurring period lasts.",
  headers: {},
  contentType: "application/json",
  body: {
    id: "evt_1QzInvoice00002",
    object: "event",
    api_version: "2025-09-30.clover",
    created: T + 31 * 86400,
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: "in_SampleInvoice0002",
        object: "invoice",
        amount_paid: 4900,
        billing_reason: "subscription_cycle",
        currency: "usd",
        customer: "cus_SampleCustomer01",
        customer_email: "emma.johnson@example.com",
        subscription: "sub_SampleSubscription01",
        status: "paid",
        status_transitions: { paid_at: T + 31 * 86400 },
        metadata: {},
      },
    },
  },
  expect: "Records the renewal (payment 2) for the affiliate who referred the subscription, if it is inside the recurring period.",
};

export const STRIPE_REFUND_SAMPLE: WebhookSample = {
  id: "stripe-charge-refunded",
  preset: "stripe",
  title: "Stripe: charge.refunded",
  description: "A refund of at least half of the payment reverses its commission (matched by payment intent, invoice or charge id).",
  headers: {},
  contentType: "application/json",
  body: {
    id: "evt_1QzRefund000003",
    object: "event",
    api_version: "2025-09-30.clover",
    created: T + 5 * 86400,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_SampleCharge0001",
        object: "charge",
        amount: 4900,
        amount_captured: 4900,
        amount_refunded: 4900,
        currency: "usd",
        customer: "cus_SampleCustomer01",
        invoice: "in_SampleInvoice0001",
        payment_intent: "pi_SamplePaymentIntent1",
        refunded: true,
      },
    },
  },
  expect: "Reverses the conversion of invoice in_SampleInvoice0001.",
};

export const STRIPE_DISPUTE_SAMPLE: WebhookSample = {
  id: "stripe-dispute",
  preset: "stripe",
  title: "Stripe: charge.dispute.created",
  description: "A dispute (chargeback) reverses the commission of the disputed payment.",
  headers: {},
  contentType: "application/json",
  body: {
    id: "evt_1QzDispute00004",
    object: "event",
    api_version: "2025-09-30.clover",
    created: T + 9 * 86400,
    type: "charge.dispute.created",
    livemode: false,
    data: {
      object: {
        id: "dp_SampleDispute0001",
        object: "dispute",
        amount: 2900,
        charge: "ch_SampleCharge0002",
        currency: "usd",
        payment_intent: "pi_SamplePaymentIntent2",
        reason: "fraudulent",
        status: "needs_response",
      },
    },
  },
  expect: "Reverses the conversion of payment intent pi_SamplePaymentIntent2.",
};

export const WOOCOMMERCE_ORDER_SAMPLE: WebhookSample = {
  id: "woocommerce-order",
  preset: "woocommerce",
  title: "WooCommerce: order (processing)",
  description:
    "WooCommerce → Settings → Advanced → Webhooks → add webhooks for \"Order created\" and \"Order updated\" with this delivery URL. Save the rz_ref cookie in the order meta \"_referzen\" (see the PHP snippet in the guide).",
  headers: { "X-WC-Webhook-Topic": "order.updated", "X-WC-Webhook-Source": "https://shop.example.com/" },
  contentType: "application/json",
  body: {
    id: 1043,
    order_key: "wc_order_8bX2kP",
    status: "processing",
    currency: "USD",
    total: "89.00",
    customer_id: 17,
    date_created_gmt: "2026-10-14T08:15:00",
    date_paid_gmt: "2026-10-14T08:16:00",
    billing: { first_name: "Lucas", last_name: "Silva", email: "lucas.silva@example.com", country: "BR" },
    meta_data: [{ id: 501, key: "_referzen", value: SAMPLE_REFERRAL_TOKEN }],
    line_items: [{ id: 1, name: "Leather Weekender Bag", quantity: 1, total: "89.00" }],
    refunds: [],
  },
  expect: "Records an $89.00 conversion for order 1043.",
};

export const WOOCOMMERCE_REFUND_SAMPLE: WebhookSample = {
  id: "woocommerce-refund",
  preset: "woocommerce",
  title: "WooCommerce: order refunded",
  description: "Orders that become refunded or cancelled (or are refunded by at least half) reverse their commission.",
  headers: { "X-WC-Webhook-Topic": "order.updated", "X-WC-Webhook-Source": "https://shop.example.com/" },
  contentType: "application/json",
  body: {
    id: 1043,
    order_key: "wc_order_8bX2kP",
    status: "refunded",
    currency: "USD",
    total: "89.00",
    customer_id: 17,
    date_created_gmt: "2026-10-14T08:15:00",
    date_modified_gmt: "2026-10-20T10:00:00",
    billing: { first_name: "Lucas", last_name: "Silva", email: "lucas.silva@example.com", country: "BR" },
    meta_data: [{ id: 501, key: "_referzen", value: SAMPLE_REFERRAL_TOKEN }],
    line_items: [{ id: 1, name: "Leather Weekender Bag", quantity: 1, total: "89.00" }],
    refunds: [{ id: 1102, reason: "Customer return", total: "-89.00" }],
  },
  expect: "Reverses the conversion of order 1043.",
};

export const WOOCOMMERCE_PING_SAMPLE: WebhookSample = {
  id: "woocommerce-ping",
  preset: "woocommerce",
  title: "WooCommerce: ping when the webhook is saved",
  description: "WooCommerce sends this once to check the delivery URL. It is acknowledged and records nothing.",
  headers: {},
  contentType: "application/x-www-form-urlencoded",
  body: "webhook_id=12",
  expect: "Acknowledged; records nothing.",
};

export const SHOPIFY_ORDER_SAMPLE: WebhookSample = {
  id: "shopify-order",
  preset: "shopify",
  title: "Shopify: orders/paid",
  description:
    "Shopify admin → Settings → Notifications → Webhooks → create \"Order payment\" and \"Refund create\" webhooks (JSON) with this URL. rz.js stores the referral token as the cart attribute \"referzen\".",
  headers: { "X-Shopify-Topic": "orders/paid", "X-Shopify-Shop-Domain": "acme-store.myshopify.com" },
  contentType: "application/json",
  body: {
    id: 5523011234,
    admin_graphql_api_id: "gid://shopify/Order/5523011234",
    order_number: 1188,
    email: "sofia.rossi@example.com",
    currency: "EUR",
    total_price: "120.00",
    financial_status: "paid",
    processed_at: "2026-10-14T08:16:00Z",
    landing_site: "/products/linen-shirt",
    note_attributes: [{ name: "referzen", value: SAMPLE_REFERRAL_TOKEN }],
    customer: { id: 7012345678, email: "sofia.rossi@example.com", first_name: "Sofia", last_name: "Rossi" },
    line_items: [{ id: 1, title: "Linen Shirt", quantity: 2, price: "60.00" }],
  },
  expect: "Records a €120.00 conversion for order 5523011234 (by the cart attribute; a ?ref=CODE on the landing page also works).",
};

export const SHOPIFY_REFUND_SAMPLE: WebhookSample = {
  id: "shopify-refund",
  preset: "shopify",
  title: "Shopify: refunds/create",
  description: "A refund of at least half of the order reverses its commission.",
  headers: { "X-Shopify-Topic": "refunds/create", "X-Shopify-Shop-Domain": "acme-store.myshopify.com" },
  contentType: "application/json",
  body: {
    id: 9081726354,
    order_id: 5523011234,
    created_at: "2026-10-18T09:00:00Z",
    note: "Wrong size",
    refund_line_items: [{ id: 1, quantity: 2, line_item_id: 1 }],
    transactions: [{ id: 6612, kind: "refund", status: "success", amount: "120.00", currency: "EUR" }],
  },
  expect: "Reverses the conversion of order 5523011234.",
};

export const GENERIC_PAYMENT_SAMPLE: WebhookSample = {
  id: "generic-payment",
  preset: "generic",
  title: "Generic: payment",
  description:
    "From any backend or no-code tool (Zapier, Make, n8n): POST JSON with the event, your order id, the amount in major units and the referral token (the rz_ref cookie) or the customer's email.",
  headers: {},
  contentType: "application/json",
  body: {
    event: "payment",
    id: "INV-2026-0042",
    amount: 199.0,
    currency: "USD",
    email: "noah.williams@example.com",
    customer: "cust_8812",
    referral: SAMPLE_REFERRAL_TOKEN,
  },
  expect: "Records a $199.00 conversion for order INV-2026-0042.",
};

export const GENERIC_REFUND_SAMPLE: WebhookSample = {
  id: "generic-refund",
  preset: "generic",
  title: "Generic: refund",
  description: "Reverse the commission of an order. Send \"amount\" for partial refunds (below half of the payment keeps the commission).",
  headers: {},
  contentType: "application/json",
  body: { event: "refund", id: "INV-2026-0042", reason: "Customer cancelled" },
  expect: "Reverses the conversion of order INV-2026-0042.",
};

export const WEBHOOK_SAMPLES: WebhookSample[] = [
  STRIPE_CHECKOUT_SAMPLE,
  STRIPE_INVOICE_SAMPLE,
  STRIPE_REFUND_SAMPLE,
  STRIPE_DISPUTE_SAMPLE,
  WOOCOMMERCE_ORDER_SAMPLE,
  WOOCOMMERCE_REFUND_SAMPLE,
  WOOCOMMERCE_PING_SAMPLE,
  SHOPIFY_ORDER_SAMPLE,
  SHOPIFY_REFUND_SAMPLE,
  GENERIC_PAYMENT_SAMPLE,
  GENERIC_REFUND_SAMPLE,
];

/**
 * A copy of the sample's body with SAMPLE_REFERRAL_TOKEN replaced by `token` and its dates moved
 * so the sample's main event happens at `nowMs` (attribution windows are checked against the
 * event time). Form-encoded bodies are returned unchanged.
 */
export function withSampleReferral(sample: WebhookSample, token: string, nowMs = Date.now()): unknown {
  if (typeof sample.body === "string") return sample.body;
  const deltaSec = Math.round(nowMs / 1000) - T;
  const walk = (value: unknown, key: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, ""));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    if (typeof value === "number" && (key === "created" || key === "paid_at")) return value + deltaSec;
    if (typeof value === "string") {
      if (value === SAMPLE_REFERRAL_TOKEN) return token;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        const utc = /Z$|[+-]\d{2}:\d{2}$/.test(value);
        const t = Date.parse(utc ? value : `${value}Z`);
        if (!Number.isNaN(t)) {
          const iso = new Date(t + deltaSec * 1000).toISOString();
          return utc ? iso.replace(/\.\d{3}Z$/, "Z") : iso.slice(0, 19);
        }
      }
    }
    return value;
  };
  return walk(sample.body, "");
}
