/**
 * Referzen referral tracker, bundled by scripts/build-widget.mjs into public/rz.js (budget: 2 KB gzip).
 *
 *   <script async src="https://PLATFORM/rz.js" data-program="PUBLIC_KEY"></script>
 *
 * Options (data-*): program (or key), api (proxy base URL, default https://PLATFORM/api),
 * param (extra referral query parameters, comma-separated; ref and via are always read),
 * domain (cookie domain such as ".example.com" for all subdomains), respect-dnt.
 *
 * When the page URL carries a referral code (?ref=CODE) the visit is sent to /api/click and the
 * returned referral token is kept in a first-party cookie "rz_ref" (+ localStorage) for the
 * program's attribution window. The token is then added to <input name="referzen"> fields,
 * forms marked data-referzen, Stripe Payment Links (client_reference_id) and the Shopify cart.
 * window.referzen: { referral, code, ready(cb), signup({ email, customerId }), convert({ amount, currency, orderId, email }) }.
 * Calls made before the script loaded are queued by the stub (see src/tracker/README.md). Never throws.
 */

import type { ClickPayload, ClickResponse, ConvertPayload, ReferralPayload } from "../referral/types";

type Callback = (r: Referzen) => void;
interface Referzen {
  (method: string, a?: unknown, b?: unknown): unknown;
  referral: string | null;
  code: string | null;
  ready(cb: Callback): void;
  signup(o: { email?: string; customerId?: string }): Promise<boolean>;
  convert(o: { amount: number; currency?: string; orderId: string; email?: string }): Promise<boolean>;
  q?: IArguments[];
}

(() => {
  try {
    const w = window as unknown as Window & { referzen?: Referzen; doNotTrack?: string; Shopify?: { shop?: string } };
    const d = document;
    const l = location;
    const script = d.currentScript as HTMLScriptElement | null;
    if (!script) return;
    const attr = (k: string) => script.getAttribute("data-" + k);
    const key = attr("program") || attr("key") || "";
    const api = (attr("api") || new URL(script.src).origin + "/api").replace(/\/+$/, "");
    const domain = attr("domain");
    const dnt = attr("respect-dnt") !== null && ((navigator as Navigator & { doNotTrack?: string }).doNotTrack == "1" || w.doNotTrack == "1");
    const NAME = "rz_ref";
    const queue = (w.referzen && w.referzen.q) || [];
    const waiting: Callback[] = [];
    let done = false;

    const post = <T>(path: string, body: unknown): Promise<T> =>
      fetch(api + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain" }, credentials: "omit", keepalive: true })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})) as Promise<T>;

    const R = ((m: string, a?: unknown, b?: unknown) => {
      try {
        const f = (R as unknown as Record<string, unknown>)[m];
        return typeof f == "function" ? f(a, b) : undefined;
      } catch {
        // never break the page
      }
    }) as Referzen;
    R.referral = R.code = null;

    const save = (t: string, c: string | null, days: number) => {
      R.referral = t;
      R.code = c;
      d.cookie = NAME + "=" + t + "; path=/; max-age=" + Math.round(days * 86400) + "; SameSite=Lax" + (domain ? "; domain=" + domain : "") + (l.protocol == "https:" ? "; Secure" : "");
      try {
        localStorage.setItem(NAME, JSON.stringify({ t, c, e: Date.now() + days * 864e5 }));
      } catch {
        // storage blocked
      }
    };

    // Restore an earlier referral (the cookie, else the localStorage copy while it is still valid).
    let stored: { t: string; c: string | null; e: number } | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(NAME) || "null");
    } catch {
      // storage blocked
    }
    if (stored && !(stored.e > Date.now())) stored = null;
    const cookie = d.cookie.match(/(?:^|; )rz_ref=([A-Za-z0-9]{16,32})/);
    if (cookie) {
      R.referral = cookie[1];
      R.code = stored && stored.t == cookie[1] ? stored.c : null;
    } else if (stored && !dnt) save(stored.t, stored.c, (stored.e - Date.now()) / 864e5);

    // Hand the token to checkouts: hidden inputs, data-referzen forms, Stripe Payment Links.
    const apply = () => {
      const t = R.referral;
      if (!t) return;
      d.querySelectorAll("form[data-referzen]").forEach((f) => {
        if (!f.querySelector("input[name=referzen]")) {
          const i = d.createElement("input");
          i.type = "hidden";
          i.name = "referzen";
          f.appendChild(i);
        }
      });
      d.querySelectorAll<HTMLInputElement>("input[name=referzen]").forEach((i) => (i.value = t));
      d.querySelectorAll<HTMLAnchorElement>("a[href*='buy.stripe.com']").forEach((a) => {
        const u = new URL(a.href);
        if (!u.searchParams.get("client_reference_id")) {
          u.searchParams.set("client_reference_id", t);
          a.href = u.href;
        }
      });
    };
    const safeApply = () => {
      try {
        apply();
      } catch {
        // ignore
      }
    };

    const finish = () => {
      done = true;
      safeApply();
      if (d.readyState == "loading") d.addEventListener("DOMContentLoaded", safeApply);
      // Shopify: store the token as a cart attribute (it shows on the order as note_attributes.referzen).
      try {
        if (R.referral && w.Shopify && w.Shopify.shop && sessionStorage.getItem(NAME) != R.referral) {
          sessionStorage.setItem(NAME, R.referral);
          fetch("/cart/update.js", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attributes: { referzen: R.referral } }) }).catch(() => 0);
        }
      } catch {
        // storage blocked
      }
      waiting.splice(0).forEach((cb) => R.ready(cb));
    };

    R.ready = (cb) => {
      if (!done) waiting.push(cb);
      else
        try {
          cb(R);
        } catch {
          // ignore errors of the caller
        }
    };
    const whenReady = <T>(send: () => Promise<T>, fallback: T): Promise<T> =>
      new Promise((resolve) => R.ready(() => resolve(R.referral && key ? send() : fallback)));
    R.signup = (o) =>
      whenReady(() => post<{ ok?: boolean }>("/referral", { k: key, t: R.referral!, e: o.email, i: o.customerId } satisfies ReferralPayload).then((r) => !!r.ok), false);
    R.convert = (o) =>
      whenReady(() => post<{ ok?: boolean }>("/convert", { k: key, t: R.referral!, a: o.amount, cur: o.currency, o: o.orderId, e: o.email } satisfies ConvertPayload).then((r) => !!r.ok), false);

    w.referzen = R;
    d.addEventListener("submit", safeApply, true);
    d.addEventListener("click", safeApply, true);
    for (const args of queue) R(args[0], args[1], args[2]);

    // A referral link visit: ?ref=CODE (or data-param / via).
    const q = new URLSearchParams(l.search);
    let code = "";
    for (const p of (attr("param") || "").split(",").concat("ref", "via")) {
      code = code || q.get(p.trim()) || "";
    }
    if (code && key && !dnt) {
      post<Partial<ClickResponse>>("/click", { k: key, c: code, u: l.href, r: d.referrer, s: q.get("sub") || q.get("sub_id") || undefined } satisfies ClickPayload)
        .then((r) => {
          if (r.t) save(r.t, r.c || null, r.d || 30);
        })
        .then(finish, finish);
    } else finish();
  } catch {
    // never break the page
  }
})();
