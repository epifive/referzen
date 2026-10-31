"""Turn raw screenshots and rendered templates into the final marketing images.

    node demo-extras.mjs          # optional sample data (see shoot.mjs for the full recipe)
    node shoot.mjs                # raw/  (needs the demo server, default http://localhost:5300)
    node render.mjs               # out/  (compositions, preview, thumbnail)
    python finalize.py            # final/
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
RAW, OUT, FINAL = HERE / "raw", HERE / "out", HERE / "final"
SHOTS = FINAL / "screenshots"

ORDER = [
    ("01-features", OUT / "features.png"),
    ("02-home", RAW / "l01-home-hero.png"),
    ("03-program-overview", RAW / "d02-overview-30.png"),
    ("04-affiliate-portal", OUT / "portal.png"),
    ("05-all-programs", RAW / "d01-programs.png"),
    ("06-affiliates", RAW / "d03-affiliates.png"),
    ("07-affiliate-detail", RAW / "d04-affiliate-detail.png"),
    ("08-conversions", RAW / "d05-conversions.png"),
    ("09-conversions-fraud-flags", RAW / "d05b-conversions-flagged.png"),
    ("10-approve-other-currency", RAW / "d05d-approve-popover.png"),
    ("11-payouts-due", RAW / "d06-payouts.png"),
    ("12-payout-batch-csv-export", RAW / "d06c-payout-batch.png"),
    ("13-marketing-assets", RAW / "d07-assets.png"),
    ("14-webhook-signing-secrets", RAW / "d08b-webhook-signing-secrets.png"),
    ("15-integration-stripe", RAW / "d08c-integrations-stripe.png"),
    ("16-integration-woocommerce", RAW / "d08d-integrations-woocommerce.png"),
    ("17-integration-shopify", RAW / "d08e-integrations-shopify.png"),
    ("18-integration-rest-api", RAW / "d08f-integrations-rest-api.png"),
    ("19-settings-commission-cookie-hold", RAW / "d09b-settings-commission.png"),
    ("20-settings-portal-branding", RAW / "d09d-settings-portal-branding.png"),
    ("21-alert-channels", RAW / "d10-alert-channels.png"),
    ("22-api-keys", RAW / "d11-api-keys.png"),
    ("23-portal-landing", RAW / "p01-portal-landing.png"),
    ("24-portal-signup", RAW / "p02-portal-signup.png"),
    ("25-portal-dashboard", RAW / "p11b-portal-dashboard-full.png"),
    ("26-portal-link-builder", RAW / "p12-portal-links.png"),
    ("27-portal-earnings-adjustments-payouts", RAW / "p13-portal-earnings.png"),
    ("28-portal-marketing-assets", RAW / "p14b-portal-banners.png"),
    ("29-portal-payout-details", RAW / "p15-portal-settings.png"),
    ("30-mobile", OUT / "mobile.png"),
    ("31-languages-rtl", OUT / "languages.png"),
    ("32-arabic-rtl-dashboard", RAW / "r2-dashboard-ar.png"),
    ("33-landing-commissions", RAW / "l06-commissions.png"),
    ("34-landing-integrations", RAW / "l07-integrations.png"),
    ("35-landing-faq", RAW / "l09-faq.png"),
    ("36-pricing", RAW / "l11-pricing.png"),
    ("37-dark-mode", RAW / "l10-home-dark.png"),
    ("38-admin-dashboard", RAW / "a1-admin-dashboard.png"),
    ("39-admin-programs", RAW / "a2-admin-programs.png"),
    ("40-admin-users", RAW / "a3-admin-users.png"),
    ("41-admin-plans", RAW / "a4-admin-plans.png"),
    ("42-admin-settings-referrals", RAW / "a5-admin-settings-referrals.png"),
    ("43-admin-languages", RAW / "a6-admin-languages.png"),
    ("44-admin-system-scheduler", RAW / "a7-admin-system.png"),
    ("45-web-installer", RAW / "i2-installer-database.png"),
]

missing = [str(src) for _, src in ORDER if not src.exists()]
if missing:
    raise SystemExit("Missing: " + ", ".join(missing))

SHOTS.mkdir(parents=True, exist_ok=True)
for old in SHOTS.glob("*.jpg"):
    old.unlink()
for name, src in ORDER:
    Image.open(src).convert("RGB").save(SHOTS / f"{name}.jpg", "JPEG", quality=88, optimize=True, progressive=True)

Image.open(OUT / "preview-590x300.png").convert("RGB").save(FINAL / "preview-590x300.jpg", "JPEG", quality=92, optimize=True)
Image.open(OUT / "thumbnail-80x80.png").save(FINAL / "thumbnail-80x80.png", optimize=True)

thumb = (FINAL / "thumbnail-80x80.png").stat().st_size
size = Image.open(FINAL / "preview-590x300.jpg").size
print(f"{len(ORDER)} screenshots, preview {size} {(FINAL / 'preview-590x300.jpg').stat().st_size // 1024} KB, thumbnail {thumb / 1024:.1f} KB")
if thumb >= 50 * 1024 or size != (590, 300):
    raise SystemExit("thumbnail or preview is not the expected size")
