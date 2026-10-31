// Optional sample data for the marketing screenshots, written straight into a throw-away demo
// database (SQLite, node:sqlite). Run it once on a fresh DEMO_SEED database, then restart the
// server (the app keeps the settings in memory).
//
//   node demo-extras.mjs [path/to/db.sqlite]
//
// Adds: Slack, Discord, Telegram, Teams and webhook alert channels (fake URLs) selected in the
// Northwind program, three API keys, two Stripe signing secrets on Northwind, SMTP settings (so
// no "email isn't set up" notice), the admin renamed "Alex Morgan", and a refunded commission
// of the demo affiliate that was already paid out (a negative adjustment for the next payout).
//
// DB: RZ_DB or the first argument (default /tmp/rz-mkt/storage/db.sqlite).
// Never run it against a database you care about: there is no restore.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DB = process.argv[2] ?? process.env.RZ_DB ?? "/tmp/rz-mkt/storage/db.sqlite";
const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 10000");
const H = 3600_000, D = 24 * H;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

if (db.prepare("SELECT id FROM alert_channels WHERE name = ?").get("#partners")) {
  console.log("already applied");
  process.exit(0);
}

function insert(table, row) {
  const keys = Object.keys(row);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
  return Number(r.lastInsertRowid);
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

const admin = db.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
db.prepare("UPDATE users SET name = 'Alex Morgan' WHERE id = ?").run(admin.id);

// Alert channels.
const t0 = iso(60 * D);
const ch = (type, name, config, active = 1) => insert("alert_channels", { user_id: admin.id, type, name, config: JSON.stringify(config), is_active: active, created_at: t0, updated_at: t0 });
const slack = ch("slack", "#partners", { webhookUrl: "https://hooks.slack.com/services/T04NWX2KQ/B07PZ3M1L/k3nZ8qLm2YvW0aXcR5tP" });
const telegram = ch("telegram", "Founders chat", { botToken: "7012345678:AAH3kz-PqLm8vXw2n5RtYc0bJ9dE4fGhUiK", chatId: "-1002345678901" });
ch("discord", "Growth team", { webhookUrl: "https://discord.com/api/webhooks/1290455718/QmV2xLk9pR3tZ8wN" });
ch("teams", "Finance (Teams)", { webhookUrl: "https://prod-42.westeurope.logic.azure.com/workflows/8c1f0e2a/triggers/manual/paths/invoke" }, 0);
ch("webhook", "Zapier: new conversions", { url: "https://hooks.zapier.com/hooks/catch/1234567/abcde1/", secret: "whk_8fQ2mZ7xL4pR9tV3" });

// Northwind sends its notifications to the owner inbox, Slack and Telegram; a few deliveries in the log.
const nw = db.prepare("SELECT id, settings FROM programs WHERE slug = 'northwind'").get();
const settings = JSON.parse(nw.settings);
settings.alertChannelIds = [...new Set([...(settings.alertChannelIds ?? []), slack, telegram])];
settings.notifyEvents = ["new_affiliate", "new_conversion", "conversion_reversed", "payout_paid"];
db.prepare("UPDATE programs SET settings = ?, webhook_secret = ? WHERE id = ?").run(
  JSON.stringify(settings),
  "whsec_9f3KcL2mQx7RvT1nB8yZ4pW6dH0sJ5aE,whsec_test_4Lq8Zr2Nx6Tm1Vb9Kc3Pw7Hy",
  nw.id,
);
for (const [channel, event, ago] of [[slack, "new_conversion", 2 * H], [telegram, "new_conversion", 2 * H], [slack, "new_affiliate", 26 * H]]) {
  insert("alert_log", { program_id: nw.id, channel_id: channel, event, ok: 1, error: null, created_at: iso(ago) });
}

// API keys (random keys; only the hash is stored, like the app does).
for (const [name, used, created] of [["Billing backend (production)", 3 * H, 41 * D], ["Zapier: sign-ups", 27 * H, 22 * D], ["Staging", null, 4 * D]]) {
  const key = "rz_" + crypto.randomBytes(30).toString("base64url").slice(0, 40);
  insert("api_keys", { user_id: admin.id, name, key_hash: crypto.createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 10), last_used_at: used ? iso(used) : null, created_at: iso(created) });
}

// SMTP, so the dashboard doesn't show "email isn't set up".
for (const [k, v] of Object.entries({ mail_enabled: "1", smtp_host: "smtp.mailgun.org", smtp_port: "587", smtp_user: "postmaster@mg.example.com", smtp_pass: "demo-not-a-real-password", mail_from_name: "Referzen", mail_from_address: "partners@example.com" })) setSetting(k, v);

affiliateExtras(nw.id);
console.log("demo extras applied to", DB);

function affiliateExtras(programId) {
  const aff = db.prepare("SELECT id FROM affiliates WHERE program_id = ? AND email = 'partner@referzen.app'").get(programId);
  if (!aff) return;
  db.prepare("UPDATE affiliates SET payout_details = ? WHERE id = ?").run(JSON.stringify({ paypalEmail: "jordan@averyonproductivity.com" }), aff.id);
  db.prepare("UPDATE payouts SET details = REPLACE(details, 'partner@referzen.app', 'jordan@averyonproductivity.com') WHERE affiliate_id = ?").run(aff.id);
  // Early (manual) approval of the demo affiliate's older pending commissions, so the next payout
  // stays above the minimum after the adjustment below.
  const at = iso(1 * D + 3 * H);
  db.prepare("UPDATE conversions SET status = 'approved', approved_at = ?, updated_at = ? WHERE affiliate_id = ? AND status = 'pending' AND flags = '' AND occurred_at < ?").run(at, at, aff.id, iso(19 * D));
  // A $79 sale that was paid out and refunded later: a negative adjustment for the next payout.
  const conv = db.prepare("SELECT id, commission_cents FROM conversions WHERE affiliate_id = ? AND status = 'paid' AND commission_cents = 2370 ORDER BY occurred_at DESC LIMIT 1").get(aff.id);
  if (conv) {
    const rev = iso(8 * D + 5 * H);
    db.prepare("UPDATE conversions SET status = 'reversed', reversed_at = ?, reversal_reason = 'Refunded', updated_at = ? WHERE id = ?").run(rev, rev, conv.id);
    insert("adjustments", { program_id: programId, affiliate_id: aff.id, conversion_id: conv.id, amount_cents: -conv.commission_cents, currency: "USD", reason: "Refunded", payout_id: null, created_at: rev });
  }
  // A recent sale paid in another currency: flagged, approved with a commission entered by hand.
  const other = db.prepare("SELECT id FROM conversions WHERE program_id = ? AND affiliate_id <> ? AND status = 'pending' AND flags = '' AND nth = 1 ORDER BY occurred_at DESC LIMIT 1").get(programId, aff.id);
  if (other) db.prepare("UPDATE conversions SET currency = 'EUR', commission_cents = 0, flags = 'currency_mismatch' WHERE id = ?").run(other.id);
}
