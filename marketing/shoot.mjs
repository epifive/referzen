// Captures marketing screenshots of a running Referzen instance with headless Chrome (CDP).
//
//   node shoot.mjs [baseUrl] [outDir] [only]
//
// baseUrl  default http://localhost:5300 (a production build seeded with DEMO_SEED=true)
// outDir   default ./raw
// only     optional comma list of name prefixes, e.g. "l,d03" (l = landing, u = sign-in pages,
//          d = merchant dashboard, p = affiliate portal, m = mobile, r = Arabic / Hindi,
//          a = admin, i = installer)
//
// Sign-in: SHOT_EMAIL / SHOT_PASSWORD (default demo@referzen.app / demo12345) for the merchant
// and admin, SHOT_AFFILIATE (default partner@referzen.app) for the portal of SHOT_PORTAL
// (default northwind). The installer shot needs a second, not installed server: SHOT_INSTALL_URL
// (e.g. http://localhost:5301). The Chrome profile is created under the system temp folder
// (override with SHOT_TMP) and removed afterwards.
//
// Recipe used for the images in marketing/final:
//   cd ../app
//   NEXT_DIST_DIR=.next-mkt npx next build            (without DEMO_SEED in the environment!)
//   STORAGE_DIR=/tmp/rz-mkt/storage APP_INSTALLED=true DB_DRIVER=sqlite DB_FILE=db.sqlite
//   ADMIN_EMAIL=demo@referzen.app ADMIN_PASSWORD=demo12345 ADMIN_NAME="Demo Admin"
//   SITE_URL=http://localhost:5300 CRON_SECRET=testsecret-long-1 DEMO_SEED=true DEMO_MODE=true
//   NEXT_DIST_DIR=.next-mkt npx next start -p 5300      (the first request seeds the demo)
//   node demo-extras.mjs, then restart the server        (channels, API keys, an adjustment …)
//   curl -H "Authorization: Bearer testsecret-long-1" http://localhost:5300/api/cron/tick
//   optional installer: STORAGE_DIR=<empty folder> NEXT_DIST_DIR=.next-mkt npx next start -p 5301
//   node shoot.mjs && node render.mjs && python finalize.py
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./lib/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:5300").replace(/\/$/, "");
const OUT = path.resolve(process.argv[3] || path.join(HERE, "raw"));
const ONLY = (process.argv[4] ?? "").split(",").filter(Boolean);
const EMAIL = process.env.SHOT_EMAIL ?? "demo@referzen.app";
const PASSWORD = process.env.SHOT_PASSWORD ?? "demo12345";
const AFFILIATE = process.env.SHOT_AFFILIATE ?? "partner@referzen.app";
const PORTAL = "/a/" + (process.env.SHOT_PORTAL ?? "northwind");
const PROGRAM = "/dashboard/programs/" + (process.env.SHOT_PROGRAM_ID ?? "1");
const INSTALL_URL = process.env.SHOT_INSTALL_URL ?? "";
// What the screenshots show instead of the local demo addresses (display only, nothing is saved).
const PUBLIC_URL = "https://partners.example.com";
const HOST = new URL(BASE).host;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\:/]/g, "\\$&");
const SWAPS = [
  [new RegExp(esc(process.env.STORAGE_DIR ?? "/tmp/rz-mkt/storage") + '[^\\s"]*', "g"), "/var/www/referzen/storage"],
  [/testsecret-long-1/g, "k3J9xQ2mV7pL5wR8"],
  [new RegExp(esc(EMAIL), "g"), "alex@example.com"],
  [new RegExp(esc(AFFILIATE), "g"), "jordan@averyonproductivity.com"],
  [new RegExp("https?://" + esc(HOST), "g"), PUBLIC_URL],
  [new RegExp(esc(HOST), "g"), new URL(PUBLIC_URL).host],
];

fs.mkdirSync(OUT, { recursive: true });
const { send, waitFor, evaluate, close, errors } = await launch();

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");

let current = { width: 1440, height: 900, mobile: false, scale: 1 };
async function viewport(width, height, { mobile = false, scale = 1 } = {}) {
  current = { width, height, mobile, scale };
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}
async function scheme(dark) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
}
async function lang(code) {
  await send("Network.setCookie", { name: "tz_lang", value: code, url: BASE + "/" });
}
async function theme(t) {
  await evaluate(`localStorage.setItem('tz-theme', '${t}'); true`);
  await scheme(t === "dark");
}
async function go(url, settle = 1800) {
  const loaded = waitFor("Page.loadEventFired");
  await send("Page.navigate", { url: url.startsWith("http") || url.startsWith("file:") ? url : BASE + url });
  await loaded;
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(settle);
  await prep();
}

// Hide scrollbars, the cookie notice and the demo-mode notices, finish entrance animations and
// swap the local demo addresses for public-looking ones (text only, nothing is saved).
async function prep() {
  await evaluate(`(() => {
    if (!document.getElementById('rz-shot')) {
      const s = document.createElement('style'); s.id = 'rz-shot';
      s.textContent = 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none} nextjs-portal{display:none!important} main > p.bg-marker:first-child{display:none!important}';
      document.head.appendChild(s);
    }
    // Demo-mode notices on the sign-in and sign-up pages.
    document.querySelectorAll('[role=status]').forEach((el) => { if (/\\bdemo\\b|Live demo/i.test(el.textContent)) el.remove(); });
    return true; })()`);
  await settleAnimations();
  await brandify();
}
async function settleAnimations() {
  // Finite animations jump to their end; looping ones (pulse, ping) are paused at a good frame.
  await evaluate(`(() => { document.getAnimations().forEach((a) => { const t = a.effect?.getTiming?.(); if (!t) return;
    if (t.iterations !== Infinity) { try { a.finish(); } catch {} return; }
    a.pause(); a.currentTime = /ping/.test(a.animationName || '') ? 250 : 0; }); return true; })()`);
}
async function brandify() {
  const swaps = SWAPS.map(([re, to]) => [re.source, re.flags, to]);
  await evaluate(`(() => {
    const swaps = ${JSON.stringify(swaps)}.map(([s, f, t]) => [new RegExp(s, f), t]);
    const swap = (v) => swaps.reduce((acc, [re, t]) => acc.replace(re, t), v);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) { const v = swap(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    document.querySelectorAll('input, textarea').forEach((el) => { if (el.value && el.type !== 'hidden') { const v = swap(el.value); if (v !== el.value) el.value = v; } if (el.placeholder) el.placeholder = swap(el.placeholder); });
    return true; })()`);
}

async function shot(name, { full = false, clip, height } = {}) {
  await sleep(150);
  const params = { format: "png" };
  if (full || height) {
    const h = height ?? (await evaluate("Math.ceil(document.documentElement.scrollHeight)"));
    params.clip = { x: 0, y: 0, width: current.width, height: h, scale: 1 };
    params.captureBeyondViewport = true;
  } else if (clip) {
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await send("Page.captureScreenshot", params);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
}
// Tall screenshot: grow the viewport to the page height first, so sticky sidebars fill it.
async function tall(name, maxHeight = 6000, minHeight = 900) {
  const h = Math.max(minHeight, Math.min(maxHeight, await evaluate("Math.ceil(document.documentElement.scrollHeight)")));
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(900);
  await settleAnimations();
  await brandify();
  await shot(name);
  await viewport(keep.width, keep.height, keep);
  return h;
}
// Tall screenshot that ends `pad` px below the element matched by the JS expression `bottomOf`.
async function tallTo(name, bottomOf, pad = 24, minHeight = 900) {
  const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(900);
  await settleAnimations();
  await brandify();
  const bottom = await evaluate(`(() => { const el = ${bottomOf}; return el ? Math.ceil(el.getBoundingClientRect().bottom + scrollY) : 0; })()`);
  // Shrink the viewport to the picture so fixed/sticky parts (sidebar footer) sit at its bottom.
  const target = bottom ? Math.max(minHeight, Math.min(h, bottom + pad)) : h;
  await viewport(current.width, target, { mobile: current.mobile, scale: current.scale });
  await sleep(700);
  await settleAnimations();
  await brandify();
  await shot(name);
  await viewport(keep.width, keep.height, keep);
}
// Scroll so the element matched by `selectorExpr` starts `offset` px below the top of the viewport.
async function scrollToEl(selectorExpr, offset = 24) {
  const ok = await evaluate(`(() => { const el = ${selectorExpr}; if (!el) return false; scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset}); return true; })()`);
  if (!ok) console.warn("  (element not found for scroll)");
  await sleep(500);
  await settleAnimations();
}
// A landing-page section (the <section> around the heading matching `re`), full width, with the
// whole page laid out in one tall viewport so scroll-triggered reveals have all run.
async function sectionShot(name, re, { padTop = 0, padBottom = 0 } = {}) {
  const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(1000);
  await settleAnimations();
  await brandify();
  const box = await evaluate(`(() => { const hd = [...document.querySelectorAll('h1,h2')].find((x) => ${re}.test(x.textContent.trim())); const s = hd?.closest('section'); if (!s) return null; const r = s.getBoundingClientRect(); return { y: Math.floor(r.top + scrollY), h: Math.ceil(r.height) }; })()`);
  if (!box) console.warn("  section not found", name);
  else await shot(name, { clip: { x: 0, y: Math.max(0, box.y - padTop), width: current.width, height: box.h + padTop + padBottom } });
  await viewport(keep.width, keep.height, keep);
}
// The home page hero down to the end of the proof strip under it.
async function heroShot(name) {
  const strip = await evaluate(`(() => { const el = [...document.querySelectorAll('main section')].find((x) => x.getBoundingClientRect().top > 300); return el ? Math.ceil(el.getBoundingClientRect().bottom) : 0; })()`);
  await viewport(1440, strip > 700 && strip < 1150 ? strip : 900);
  await sleep(600);
  await settleAnimations();
  await shot(name);
  await viewport(1440, 900);
}
const want = (name) => !ONLY.length || ONLY.some((p) => name.startsWith(p) || p.startsWith(name));

async function login(loginPath, email, password) {
  await go(loginPath, 1000);
  await evaluate(`(() => { const set = (n, v) => { const el = document.querySelector('input[name=' + n + ']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(password)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const p = await evaluate("location.pathname");
    if (p !== loginPath) return p;
  }
  throw new Error("login failed: " + loginPath);
}
const clickText = (selector, re) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${re}.test(x.textContent.trim())); el?.click(); return !!el; })()`);
// The card (rounded box) around the heading whose text matches `re`.
const card = (re) => `(() => { const h = [...document.querySelectorAll('h1,h2,h3')].find((x) => ${re}.test(x.textContent.trim())); let c = h; while (c && c.parentElement && !/rounded/.test(c.className?.baseVal ?? c.className ?? '')) c = c.parentElement; return c; })()`;
const heading = (re) => `[...document.querySelectorAll('h1,h2,h3')].find((x) => ${re}.test(x.textContent.trim()))`;
// Fill text inputs for a nicer picture (the form is never submitted).
const fill = (pairs) =>
  evaluate(`(() => { for (const [sel, v] of ${JSON.stringify(pairs)}) { const el = document.querySelector(sel); if (!el) continue; el.removeAttribute('disabled'); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    if (el.type === 'checkbox') el.checked = !!v; else Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); }
    document.querySelectorAll('form [disabled]').forEach((el) => el.removeAttribute('disabled')); return true; })()`);
const PHONE = { mobile: true, scale: 2 };

try {
  await viewport(1440, 900);
  await scheme(false);
  await go("/", 300);
  await evaluate("localStorage.setItem('rz-cookie-consent','1'); localStorage.setItem('tz-theme','light'); true");
  await lang("en");

  // ── Landing (signed out) ──
  if (want("l")) {
    if (want("l01")) {
      await go("/", 2500);
      await heroShot("l01-home-hero");
    }
    if (want("l02")) {
      await go("/", 1500);
      await evaluate(`(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); return true; })()`);
      await sleep(1200);
      await tall("l02-home-full", 14000);
    }
    const sections = [
      ["l03-how-it-works", "/^Live in an afternoon/"],
      ["l04-features", "/^Everything a referral program needs/"],
      ["l05-portal-showcase", "/^A portal your affiliates/"],
      ["l06-commissions", "/^Any commission/"],
      ["l07-integrations", "/^Works with the stack/"],
      ["l08-pricing-teaser", "/^Start free, upgrade/"],
      ["l09-faq", "/^Questions merchants ask/"],
    ];
    if (sections.some(([n]) => want(n))) {
      await go("/", 2000);
      for (const [name, re] of sections) if (want(name)) await sectionShot(name, re);
    }
    if (want("l10")) {
      await theme("dark");
      await go("/", 2500);
      await heroShot("l10-home-dark");
      await sectionShot("l10b-features-dark", "/^Everything a referral program needs/");
      await theme("light");
    }
    if (want("l11")) {
      await go("/pricing", 1500);
      await tallTo("l11-pricing", card("/^Agency$/"), 64);
    }
    for (const [name, code] of [["l12-home-hi", "hi"], ["l13-home-ar", "ar"]]) {
      if (!want(name)) continue;
      await lang(code);
      await go("/", 2500);
      await heroShot(name);
      await lang("en");
    }
  }

  // ── Sign-in pages and the portal before signing in ──
  if (want("u")) {
    if (want("u1")) {
      await go("/login", 1200);
      await shot("u1-login");
    }
    if (want("u2")) {
      await go("/register", 1200);
      await shot("u2-register");
    }
  }
  if (want("p0")) {
    await go(PORTAL, 2000);
    await shot("p01-portal-landing");
    await tall("p01b-portal-landing-full", 3000);
    await go(PORTAL + "/signup", 1500);
    await fill([["input[name=name]", "Sam Taylor"], ["input[name=email]", "sam@growthnotes.io"], ["input[name=password]", "a-long-password"], ["input[name=website]", "https://growthnotes.io"]]);
    await shot("p02-portal-signup");
    await go(PORTAL + "/login", 1500);
    await shot("p03-portal-login");
  }
  if (want("m1")) {
    await viewport(390, 844, PHONE);
    await go("/", 2500);
    await shot("m1-home");
    await go(PORTAL, 2500);
    await shot("m4-portal-landing");
    await viewport(1440, 900);
  }

  // ── Affiliate portal (signed in as the demo affiliate) ──
  const needPortal = ["p", "m", "r"].some((p) => ONLY.length === 0 || ONLY.some((o) => o.startsWith(p) && o !== "p0" && o !== "m1"));
  if (needPortal) {
    console.log("portal login ->", await login(PORTAL + "/login", AFFILIATE, PASSWORD));
  }
  if (want("p1")) {
    await go(PORTAL + "/dashboard", 2500);
    await shot("p11-portal-dashboard");
    await tall("p11b-portal-dashboard-full", 2400);
    await go(PORTAL + "/links", 2000);
    await evaluate(`(() => { const el = [...document.querySelectorAll('input')].find((x) => x.type === 'text' && !x.readOnly && !x.name.includes('sub')); return !!el; })()`);
    await shot("p12-portal-links");
    await go(PORTAL + "/earnings", 2000);
    await tall("p13-portal-earnings", 2600);
    await scrollToEl(heading("/^Adjustments$/"), 96);
    await brandify();
    await shot("p13b-portal-adjustments-payouts");
    await go(PORTAL + "/assets", 2000);
    await shot("p14-portal-assets");
    await scrollToEl(heading("/^Leaderboard/"), 96);
    await shot("p14b-portal-banners");
    await go(PORTAL + "/settings", 2000);
    await shot("p15-portal-settings");
  }
  if (want("m2")) {
    await viewport(390, 844, PHONE);
    await go(PORTAL + "/dashboard", 2500);
    await shot("m2-portal-dashboard");
    await go(PORTAL + "/earnings", 2500);
    await shot("m3-portal-earnings");
    await viewport(1440, 900);
  }
  if (want("r1")) {
    await lang("ar");
    await go(PORTAL + "/dashboard", 2500);
    await shot("r1-portal-ar");
    await viewport(390, 844, PHONE);
    await go(PORTAL + "/dashboard", 2500);
    await shot("r1b-portal-ar-mobile");
    await viewport(1440, 900);
    await lang("en");
  }

  // ── Merchant dashboard ──
  const needLogin = ["d", "m", "r", "a"].some((p) => ONLY.length === 0 || ONLY.some((o) => o.startsWith(p) && o !== "m1" && o !== "m2"));
  if (needLogin) console.log("login ->", await login("/login", EMAIL, PASSWORD));

  if (want("d")) {
    const P = PROGRAM;
    if (want("d01")) {
      await go("/dashboard", 2000);
      await shot("d01-programs");
    }
    if (want("d02")) {
      await go(P, 2500);
      await shot("d02-overview-30");
      await tall("d02b-overview-full", 2000);
      await go(P + "?period=7", 2500);
      await shot("d02c-overview-7");
      await go(P + "?period=90", 2500);
      await shot("d02d-overview-90");
    }
    if (want("d03")) {
      await go(P + "/affiliates", 2000);
      await shot("d03-affiliates");
    }
    if (want("d04")) {
      await go(P + "/affiliates/3", 2500);
      await shot("d04-affiliate-detail");
      await scrollToEl(card("/^Profile and commission$/"), 24);
      await brandify();
      await shot("d04b-affiliate-profile");
    }
    if (want("d05")) {
      await go(P + "/conversions", 2000);
      await shot("d05-conversions");
      await go(P + "/conversions?status=pending&flagged=1", 2000);
      await shot("d05b-conversions-flagged");
      await go(P + "/conversions?source=stripe&status=approved", 2000);
      await shot("d05c-conversions-filtered");
      // The approve popover of a sale paid in another currency (commission entered on approval).
      await go(P + "/conversions?status=pending", 2000);
      const opened = await evaluate(`(() => { const d = [...document.querySelectorAll('details')].find((x) => /^Approve$/.test(x.querySelector('summary')?.textContent.trim() ?? '')); if (!d) return false; d.open = true; d.scrollIntoView({ block: 'center' }); return true; })()`);
      console.log("  approve popover", opened);
      await sleep(600);
      await brandify();
      await shot("d05d-approve-popover");
      // The reverse popover of the second conversion of the list.
      await go(P + "/conversions", 2000);
      await evaluate(`(() => { const all = [...document.querySelectorAll('details')].filter((x) => /^Reverse/.test(x.querySelector('summary')?.textContent.trim() ?? '')); const d = all[1] ?? all[0]; if (d) d.open = true; return !!d; })()`);
      await sleep(600);
      await brandify();
      await shot("d05e-reverse-popover");
    }
    if (want("d06")) {
      await go(P + "/payouts", 2000);
      await shot("d06-payouts");
      await tall("d06b-payouts-full", 2000);
      await go(P + "/payouts/6", 2000);
      await shot("d06c-payout-batch");
      await scrollToEl(card("/^Download$/"), 24);
      await brandify();
      await shot("d06d-payout-csv");
    }
    if (want("d07")) {
      await go(P + "/assets", 2000);
      await shot("d07-assets");
    }
    if (want("d08")) {
      await go(P + "/integrations", 2000);
      await shot("d08-integrations-top");
      await scrollToEl(card("/^2\. Connect your payments/"), 24);
      await brandify();
      await shot("d08b-webhook-signing-secrets");
      for (const [name, tab, target] of [
        ["d08c-integrations-stripe", "stripe", null],
        ["d08d-integrations-woocommerce", "woocommerce", null],
        ["d08e-integrations-shopify", "shopify", null],
        ["d08f-integrations-rest-api", "api", null],
      ]) {
        await go(P + "/integrations#" + tab, 2000);
        await evaluate(`(() => { const t = document.getElementById('tab-${tab}'); t?.click(); return !!t; })()`);
        await sleep(700);
        await scrollToEl(target ?? "document.querySelector('[role=tablist]')", 24);
        await brandify();
        await shot(name);
      }
    }
    if (want("d09")) {
      await go(P + "/settings", 2000);
      await shot("d09-settings-general");
      for (const [name, re] of [
        ["d09b-settings-commission", "/^Commission$/"],
        ["d09c-settings-payouts", "/^Payouts$/"],
        ["d09d-settings-portal-branding", "/^Affiliate portal$/"],
        ["d09e-settings-tracking", "/^Tracking$/"],
        ["d09f-settings-notifications", "/^Notifications$/"],
      ]) {
        await scrollToEl(`[...document.querySelectorAll('h2')].find((x) => ${re}.test(x.textContent.trim()))`, 32);
        await brandify();
        await shot(name);
      }
    }
    if (want("d10")) {
      await go("/dashboard/channels", 2000);
      await shot("d10-alert-channels");
      await go("/dashboard/channels/new", 2000);
      await shot("d10b-alert-channel-new");
      await go("/dashboard/api-keys", 2000);
      await shot("d11-api-keys");
    }
  }

  // ── Mobile merchant dashboard ──
  if (want("m5")) {
    await viewport(390, 844, PHONE);
    await go(PROGRAM, 2500);
    await shot("m5-merchant-overview");
    await viewport(1440, 900);
  }

  // ── Arabic RTL and Hindi merchant dashboard ──
  if (want("r2")) {
    await lang("ar");
    await go(PROGRAM, 2500);
    await shot("r2-dashboard-ar");
    await lang("hi");
    await go(PROGRAM, 2500);
    await shot("r3-dashboard-hi");
    await go(PROGRAM + "/conversions", 2000);
    await shot("r4-conversions-hi");
    await lang("en");
  }

  // ── Admin ──
  if (want("a")) {
    for (const [name, url] of [
      ["a1-admin-dashboard", "/admin"],
      ["a2-admin-programs", "/admin/programs"],
      ["a3-admin-users", "/admin/users"],
      ["a4-admin-plans", "/admin/plans"],
      ["a5-admin-settings-referrals", "/admin/settings/referrals"],
      ["a6-admin-languages", "/admin/languages"],
      ["a7-admin-system", "/admin/system"],
      ["a8-admin-payments", "/admin/payments"],
      ["a9-admin-translate", "/admin/languages/ar"],
    ]) {
      if (!want(name)) continue;
      await go(url, 2000);
      if (name === "a7-admin-system") await tallTo(name, card("/^Data$/"), 20);
      else if (name === "a1-admin-dashboard") await tall(name, 1600);
      else await shot(name);
    }
  }

  // ── Installer (a second server without APP_INSTALLED) ──
  if (want("i") && INSTALL_URL) {
    await go(INSTALL_URL + "/install", 2000);
    await shot("i1-installer");
    await clickText("button", /^Continue$/);
    await sleep(1500);
    await prep();
    await shot("i2-installer-database");
  }

  console.log("errors:", errors.length ? [...new Set(errors)].slice(0, 25) : "none");
} finally {
  await close();
}
process.exit(0);
