import "server-only";
import type { Kysely } from "kysely";
import type { Database } from "./schema";
import { acquireSeedLock, finishSeedLock, releaseSeedLock } from "./seed-lock";

/** Translations of the default site texts, so the demo's home page is fully translated. */
const SITE_TEXTS: Record<string, Record<string, string>> = {
  ar: {
    "setting.site_tagline": "برامج التسويق بالعمولة والإحالة بكل سهولة",
    "setting.home_hero_title": "حوّل عملاءك إلى فريق مبيعاتك",
    "setting.home_hero_subtitle":
      "أطلق برنامج التسويق بالعمولة الخاص بك في دقائق: تتبّع الإحالات من Stripe وWooCommerce وShopify، وادفع العمولات بملف CSV واحد، وامنح كل مسوّق بالعمولة بوابته الخاصة التي تحمل علامتك التجارية.",
    "setting.footer_text": "برامج التسويق بالعمولة والإحالة لخدمات SaaS والمتاجر الإلكترونية.",
    "setting.copyright_text": "© {year} {site_name}. جميع الحقوق محفوظة.",
    "setting.cookie_consent_text": "نستخدم ملفات تعريف الارتباط لإبقائك مسجلًا الدخول ولفهم كيفية استخدام الموقع. باستمرارك في التصفح فإنك توافق على استخدامنا لها.",
  },
  hi: {
    "setting.site_tagline": "एफ़िलिएट और रेफ़रल प्रोग्राम, अब आसान",
    "setting.home_hero_title": "अपने ग्राहकों को अपनी सेल्स टीम बनाइए",
    "setting.home_hero_subtitle":
      "कुछ ही मिनटों में अपना एफ़िलिएट प्रोग्राम शुरू करें: Stripe, WooCommerce और Shopify से रेफ़रल ट्रैक करें, एक CSV फ़ाइल से कमीशन का भुगतान करें, और हर एफ़िलिएट को आपकी ब्रांडिंग वाला अपना पोर्टल दें।",
    "setting.footer_text": "SaaS और ऑनलाइन स्टोर के लिए एफ़िलिएट और रेफ़रल प्रोग्राम।",
    "setting.copyright_text": "© {year} {site_name}. सर्वाधिकार सुरक्षित।",
    "setting.cookie_consent_text": "हम आपको साइन इन रखने और साइट के इस्तेमाल को समझने के लिए कुकी का इस्तेमाल करते हैं। आगे बढ़कर आप कुकी के इस्तेमाल से सहमत होते हैं।",
  },
};

interface LanguagePack {
  language: { code: string; name: string; native_name: string; direction: "ltr" | "rtl" };
  translations: Record<string, string>;
}

/** Install the bundled Hindi and Arabic packs on a demo site (once, guarded by a settings row). */
export async function seedDemoLanguages(db: Kysely<Database>): Promise<void> {
  const lock = await acquireSeedLock(db, "demo_languages_seeded_at");
  if (!lock) return;
  try {
    await installPacks(db);
  } catch (err) {
    await releaseSeedLock(db, lock);
    throw err;
  }
  await finishSeedLock(db, lock);
}

async function installPacks(db: Kysely<Database>): Promise<void> {
  const packs = [(await import("../../../languages/hi.json")).default, (await import("../../../languages/ar.json")).default] as LanguagePack[];
  for (const [index, pack] of packs.entries()) {
    const { code, name, native_name, direction } = pack.language;
    const exists = await db.selectFrom("languages").select("code").where("code", "=", code).executeTakeFirst();
    if (exists) continue;
    const rows = Object.entries({ ...pack.translations, ...SITE_TEXTS[code] }).map(([key, value]) => ({ lang: code, key, value }));
    await db.transaction().execute(async (trx) => {
      await trx.insertInto("languages").values({ code, name, native_name, direction, is_active: 1, sort_order: (index + 1) * 10 }).execute();
      for (let i = 0; i < rows.length; i += 200) await trx.insertInto("translations").values(rows.slice(i, i + 200)).execute();
    });
  }
}
