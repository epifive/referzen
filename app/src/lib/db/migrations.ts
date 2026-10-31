import "server-only";
import { sql, type Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { DEFAULT_PAGES } from "./seed-pages";
import { DEFAULT_POSTS } from "./seed-posts";

/**
 * Versioned schema migrations. They run automatically on first database
 * access after an update, so buyers only need to replace files and restart.
 * Never edit a released migration: add a new one instead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

const ts = () => new Date().toISOString();

const migrations: Record<string, Migration> = {
  "2026_10_18_000001_initial_schema": {
    async up(db: AnyDb) {
      await db.schema
        .createTable("settings")
        .addColumn("key", "varchar(100)", (c) => c.primaryKey())
        .addColumn("value", "text")
        .execute();

      await db.schema
        .createTable("users")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("password_hash", "varchar(255)", (c) => c.notNull())
        .addColumn("role", "varchar(20)", (c) => c.notNull().defaultTo("user"))
        .addColumn("status", "varchar(20)", (c) => c.notNull().defaultTo("active"))
        .addColumn("plan_id", "integer")
        .addColumn("plan_expires_at", "varchar(32)")
        .addColumn("stripe_customer_id", "varchar(100)")
        .addColumn("stripe_subscription_id", "varchar(100)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("sessions")
        .addColumn("id", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("user_agent", "varchar(255)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();

      await db.schema
        .createTable("password_resets")
        .addColumn("token_hash", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("plans")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(100)", (c) => c.notNull())
        .addColumn("description", "varchar(255)")
        .addColumn("price_monthly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("price_yearly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("features", "text")
        // 0 means unlimited for the three limits below.
        .addColumn("max_programs", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("max_affiliates", "integer", (c) => c.notNull().defaultTo(25))
        .addColumn("max_monthly_conversions", "integer", (c) => c.notNull().defaultTo(50))
        .addColumn("allow_api", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("remove_branding", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_free", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("is_featured", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("payments")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("plan_id", "integer", (c) => c.notNull())
        .addColumn("amount", "integer", (c) => c.notNull())
        .addColumn("currency", "varchar(10)", (c) => c.notNull())
        .addColumn("billing_cycle", "varchar(10)", (c) => c.notNull())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_ref", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("status", "varchar(20)", (c) => c.notNull())
        .addColumn("note", "text")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("payments_user_id_idx").on("payments").column("user_id").execute();

      await db.schema
        .createTable("pages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(120)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("meta_description", "varchar(255)")
        .addColumn("is_published", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("show_in_footer", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("contact_messages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull())
        .addColumn("subject", "varchar(255)", (c) => c.notNull())
        .addColumn("message", "text", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("is_read", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("languages")
        .addColumn("code", "varchar(12)", (c) => c.primaryKey())
        .addColumn("name", "varchar(60)", (c) => c.notNull())
        .addColumn("native_name", "varchar(60)", (c) => c.notNull())
        .addColumn("direction", "varchar(3)", (c) => c.notNull().defaultTo("ltr"))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createTable("translations")
        .addColumn("lang", "varchar(12)", (c) => c.notNull())
        .addColumn("key", "varchar(190)", (c) => c.notNull())
        .addColumn("value", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("translations_pk", ["lang", "key"])
        .execute();

      await db.schema
        .createTable("posts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(160)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("excerpt", "varchar(500)")
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("cover_image", "varchar(500)")
        .addColumn("meta_description", "varchar(255)")
        .addColumn("status", "varchar(12)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("published_at", "varchar(32)")
        .addColumn("views", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("posts_status_published_idx").on("posts").columns(["status", "published_at"]).execute();

      // ── Referral programs ──
      await db.schema
        .createTable("programs")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("slug", "varchar(60)", (c) => c.notNull().unique())
        .addColumn("domain", "varchar(255)", (c) => c.notNull())
        .addColumn("currency", "varchar(3)", (c) => c.notNull().defaultTo("USD"))
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("active"))
        .addColumn("public_key", "varchar(32)", (c) => c.notNull().unique())
        .addColumn("webhook_token", "varchar(48)", (c) => c.notNull().unique())
        .addColumn("webhook_secret", "varchar(255)")
        .addColumn("verified_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("programs_user_idx").on("programs").column("user_id").execute();

      await db.schema
        .createTable("affiliates")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("password_hash", "varchar(255)")
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("code", "varchar(40)", (c) => c.notNull())
        .addColumn("coupon_code", "varchar(60)")
        .addColumn("commission_override", "varchar(255)")
        .addColumn("payout_method", "varchar(10)", (c) => c.notNull().defaultTo("paypal"))
        .addColumn("payout_details", "text", (c) => c.notNull())
        .addColumn("website", "varchar(255)")
        .addColumn("notes", "text")
        .addColumn("last_visitor_hash", "varchar(64)")
        .addColumn("approved_at", "varchar(32)")
        .addColumn("last_login_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("affiliates_program_email_uq", ["program_id", "email"])
        .addUniqueConstraint("affiliates_program_code_uq", ["program_id", "code"])
        .execute();
      await db.schema.createIndex("affiliates_program_status_idx").on("affiliates").columns(["program_id", "status"]).execute();

      await db.schema
        .createTable("affiliate_sessions")
        .addColumn("id", "varchar(64)", (c) => c.primaryKey())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("user_agent", "varchar(255)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("affiliate_sessions_affiliate_idx").on("affiliate_sessions").column("affiliate_id").execute();

      await db.schema
        .createTable("affiliate_password_resets")
        .addColumn("token_hash", "varchar(64)", (c) => c.primaryKey())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("clicks")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("ts", "varchar(32)", (c) => c.notNull())
        .addColumn("token", "varchar(32)", (c) => c.notNull())
        .addColumn("landing_path", "varchar(500)", (c) => c.notNull().defaultTo("/"))
        .addColumn("referrer_host", "varchar(255)", (c) => c.notNull().defaultTo(""))
        .addColumn("visitor_hash", "varchar(32)", (c) => c.notNull())
        .addColumn("country", "varchar(2)", (c) => c.notNull().defaultTo(""))
        .addColumn("device", "varchar(10)", (c) => c.notNull().defaultTo("desktop"))
        .addColumn("sub_id", "varchar(60)", (c) => c.notNull().defaultTo(""))
        .addColumn("is_duplicate", "integer", (c) => c.notNull().defaultTo(0))
        .execute();
      await db.schema.createIndex("clicks_program_ts_idx").on("clicks").columns(["program_id", "ts"]).execute();
      await db.schema.createIndex("clicks_program_affiliate_ts_idx").on("clicks").columns(["program_id", "affiliate_id", "ts"]).execute();
      await db.schema.createIndex("clicks_token_idx").on("clicks").column("token").execute();
      await db.schema.createIndex("clicks_visitor_idx").on("clicks").columns(["program_id", "visitor_hash", "ts"]).execute();

      await db.schema
        .createTable("click_daily")
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("day", "varchar(10)", (c) => c.notNull())
        .addColumn("clicks", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("unique_clicks", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("click_daily_pk", ["program_id", "affiliate_id", "day"])
        .execute();
      await db.schema.createIndex("click_daily_program_day_idx").on("click_daily").columns(["program_id", "day"]).execute();

      await db.schema
        .createTable("referrals")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("token", "varchar(32)", (c) => c.notNull())
        .addColumn("email", "varchar(190)")
        .addColumn("email_hash", "varchar(64)")
        .addColumn("customer_ref", "varchar(190)")
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("lead"))
        .addColumn("source", "varchar(16)", (c) => c.notNull().defaultTo("js"))
        .addColumn("sub_id", "varchar(60)", (c) => c.notNull().defaultTo(""))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("converted_at", "varchar(32)")
        .execute();
      await db.schema.createIndex("referrals_program_created_idx").on("referrals").columns(["program_id", "created_at"]).execute();
      await db.schema.createIndex("referrals_program_affiliate_idx").on("referrals").columns(["program_id", "affiliate_id"]).execute();
      await db.schema.createIndex("referrals_program_token_idx").on("referrals").columns(["program_id", "token"]).execute();
      await db.schema.createIndex("referrals_program_email_idx").on("referrals").columns(["program_id", "email_hash"]).execute();
      await db.schema.createIndex("referrals_program_customer_idx").on("referrals").columns(["program_id", "customer_ref"]).execute();

      await db.schema
        .createTable("conversions")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("referral_id", "integer")
        .addColumn("source", "varchar(16)", (c) => c.notNull())
        .addColumn("external_id", "varchar(190)", (c) => c.notNull())
        .addColumn("customer_ref", "varchar(190)")
        .addColumn("subscription_ref", "varchar(190)")
        .addColumn("nth", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("amount_cents", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("currency", "varchar(3)", (c) => c.notNull())
        .addColumn("commission_cents", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("flags", "varchar(255)", (c) => c.notNull().defaultTo(""))
        .addColumn("payout_id", "integer")
        .addColumn("occurred_at", "varchar(32)", (c) => c.notNull())
        .addColumn("approved_at", "varchar(32)")
        .addColumn("paid_at", "varchar(32)")
        .addColumn("reversed_at", "varchar(32)")
        .addColumn("reversal_reason", "varchar(255)")
        .addColumn("note", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("conversions_program_source_external_uq", ["program_id", "source", "external_id"])
        .execute();
      await db.schema.createIndex("conversions_program_occurred_idx").on("conversions").columns(["program_id", "occurred_at"]).execute();
      await db.schema.createIndex("conversions_program_affiliate_idx").on("conversions").columns(["program_id", "affiliate_id", "status"]).execute();
      await db.schema.createIndex("conversions_program_status_idx").on("conversions").columns(["program_id", "status", "occurred_at"]).execute();
      await db.schema.createIndex("conversions_program_customer_idx").on("conversions").columns(["program_id", "customer_ref"]).execute();
      await db.schema.createIndex("conversions_program_subscription_idx").on("conversions").columns(["program_id", "subscription_ref"]).execute();
      await db.schema.createIndex("conversions_payout_idx").on("conversions").column("payout_id").execute();

      await db.schema
        .createTable("payout_batches")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("currency", "varchar(3)", (c) => c.notNull())
        .addColumn("total_cents", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("payout_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("note", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("paid_at", "varchar(32)")
        .execute();
      await db.schema.createIndex("payout_batches_program_idx").on("payout_batches").columns(["program_id", "created_at"]).execute();

      await db.schema
        .createTable("payouts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("batch_id", "integer")
        .addColumn("amount_cents", "bigint", (c) => c.notNull())
        .addColumn("currency", "varchar(3)", (c) => c.notNull())
        .addColumn("method", "varchar(10)", (c) => c.notNull())
        .addColumn("details", "text", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("reference", "varchar(190)")
        .addColumn("conversion_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("paid_at", "varchar(32)")
        .execute();
      await db.schema.createIndex("payouts_program_status_idx").on("payouts").columns(["program_id", "status"]).execute();
      await db.schema.createIndex("payouts_program_affiliate_idx").on("payouts").columns(["program_id", "affiliate_id"]).execute();
      await db.schema.createIndex("payouts_batch_idx").on("payouts").column("batch_id").execute();

      await db.schema
        .createTable("assets")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("type", "varchar(10)", (c) => c.notNull())
        .addColumn("title", "varchar(160)", (c) => c.notNull())
        .addColumn("url", "varchar(1000)", (c) => c.notNull().defaultTo(""))
        .addColumn("image", "varchar(500)")
        .addColumn("content", "text")
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("assets_program_idx").on("assets").columns(["program_id", "sort_order"]).execute();

      await db.schema
        .createTable("api_keys")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("key_hash", "varchar(64)", (c) => c.notNull().unique())
        .addColumn("prefix", "varchar(12)", (c) => c.notNull())
        .addColumn("last_used_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("api_keys_user_idx").on("api_keys").column("user_id").execute();

      await db.schema
        .createTable("usage_monthly")
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("month", "varchar(7)", (c) => c.notNull())
        .addColumn("conversions", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("clicks", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("usage_monthly_pk", ["user_id", "month"])
        .execute();

      await db.schema
        .createTable("alert_channels")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("type", "varchar(12)", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("config", "text", (c) => c.notNull())
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("alert_channels_user_idx").on("alert_channels").column("user_id").execute();

      await db.schema
        .createTable("alert_log")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer")
        .addColumn("channel_id", "integer")
        .addColumn("event", "varchar(30)", (c) => c.notNull())
        .addColumn("ok", "integer", (c) => c.notNull())
        .addColumn("error", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("alert_log_program_idx").on("alert_log").columns(["program_id", "created_at"]).execute();
    },
    async down(db: AnyDb) {
      for (const table of [
        "alert_log",
        "alert_channels",
        "usage_monthly",
        "api_keys",
        "assets",
        "payouts",
        "payout_batches",
        "conversions",
        "referrals",
        "click_daily",
        "clicks",
        "affiliate_password_resets",
        "affiliate_sessions",
        "affiliates",
        "programs",
        "posts",
        "translations",
        "languages",
        "contact_messages",
        "pages",
        "payments",
        "plans",
        "password_resets",
        "sessions",
        "users",
        "settings",
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  },

  "2026_10_18_000002_seed_defaults": {
    async up(db: AnyDb) {
      const now = ts();
      await db
        .insertInto("plans")
        .values([
          {
            name: "Free",
            description: "Try a referral program with your first affiliates.",
            price_monthly: 0,
            price_yearly: 0,
            // Display text only (see Admin → Plans).
            features: [
              "1 referral program",
              "25 affiliates",
              "50 conversions per month",
              "Stripe, WooCommerce and Shopify webhooks",
              "Branded affiliate portal",
              "PayPal payouts CSV",
            ].join("\n"),
            max_programs: 1,
            max_affiliates: 25,
            max_monthly_conversions: 50,
            allow_api: 0,
            remove_branding: 0,
            is_free: 1,
            is_active: 1,
            is_featured: 0,
            sort_order: 1,
            created_at: now,
          },
          {
            name: "Pro",
            description: "For growing SaaS products and online stores.",
            price_monthly: 1900,
            price_yearly: 19000,
            features: [
              "3 referral programs",
              "1,000 affiliates",
              "2,000 conversions per month",
              "Recurring commissions and custom rates",
              "REST API",
              "Everything in Free",
            ].join("\n"),
            max_programs: 3,
            max_affiliates: 1000,
            max_monthly_conversions: 2000,
            allow_api: 1,
            remove_branding: 1,
            is_free: 0,
            is_active: 1,
            is_featured: 1,
            sort_order: 2,
            created_at: now,
          },
          {
            name: "Agency",
            description: "For agencies and businesses running many programs.",
            price_monthly: 4900,
            price_yearly: 49000,
            features: ["20 referral programs", "Unlimited affiliates", "Unlimited conversions", "REST API", "Everything in Pro"].join("\n"),
            max_programs: 20,
            max_affiliates: 0,
            max_monthly_conversions: 0,
            allow_api: 1,
            remove_branding: 1,
            is_free: 0,
            is_active: 1,
            is_featured: 0,
            sort_order: 3,
            created_at: now,
          },
        ])
        .execute();

      await db
        .insertInto("pages")
        .values(
          DEFAULT_PAGES.map((p) => ({
            slug: p.slug,
            title: p.title,
            content: p.content,
            meta_description: p.metaDescription,
            is_published: 1,
            show_in_footer: 1,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();

      await db.insertInto("languages").values({ code: "en", name: "English", native_name: "English", direction: "ltr", is_active: 1, sort_order: 0 }).execute();
      await db
        .insertInto("posts")
        .values(
          DEFAULT_POSTS.map((p, i) => ({
            slug: p.slug,
            title: p.title,
            excerpt: p.excerpt,
            content: p.content,
            cover_image: null,
            meta_description: p.metaDescription,
            status: "published",
            published_at: new Date(Date.now() - (DEFAULT_POSTS.length - i) * 86_400_000).toISOString(),
            views: 0,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();
    },
    async down(db: AnyDb) {
      for (const table of ["posts", "languages", "pages", "plans"]) await sql`DELETE FROM ${sql.table(table)}`.execute(db);
    },
  },

  /**
   * Payment refs (Stripe payment intent / charge of a subscription invoice, so refunds and
   * disputes find the conversion), balance adjustments (a paid commission that is reversed is
   * deducted from the next payout), coupon lookups, and the plan feature text.
   */
  "2026_10_19_000003_payment_refs_adjustments": {
    async up(db: AnyDb) {
      await db.schema.alterTable("conversions").addColumn("payment_ref", "varchar(190)").execute();
      await db.schema.alterTable("conversions").addColumn("charge_ref", "varchar(190)").execute();
      await db.schema.createIndex("conversions_program_payment_ref_idx").on("conversions").columns(["program_id", "payment_ref"]).execute();
      await db.schema.createIndex("conversions_program_charge_ref_idx").on("conversions").columns(["program_id", "charge_ref"]).execute();

      await db.schema.alterTable("payouts").addColumn("adjustment_cents", "bigint", (c) => c.notNull().defaultTo(0)).execute();

      await db.schema
        .createTable("adjustments")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("program_id", "integer", (c) => c.notNull())
        .addColumn("affiliate_id", "integer", (c) => c.notNull())
        .addColumn("conversion_id", "integer")
        .addColumn("amount_cents", "bigint", (c) => c.notNull())
        .addColumn("currency", "varchar(3)", (c) => c.notNull())
        .addColumn("reason", "varchar(255)")
        .addColumn("payout_id", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("adjustments_program_affiliate_idx").on("adjustments").columns(["program_id", "affiliate_id", "payout_id"]).execute();
      await db.schema.createIndex("adjustments_payout_idx").on("adjustments").column("payout_id").execute();

      await db.schema.createIndex("affiliates_program_coupon_idx").on("affiliates").columns(["program_id", "coupon_code"]).execute();

      // Every plan has recurring commissions and per-affiliate rates: list them under Free (the
      // other plans include "Everything in Free") instead of suggesting a Pro-only feature.
      // Only plans that still use the default text are changed.
      const feature = "Recurring commissions and custom rates";
      const plans = await db.selectFrom("plans").select(["id", "features", "is_free"]).execute();
      for (const plan of plans as Array<{ id: number; features: string | null; is_free: number }>) {
        const lines = (plan.features ?? "").split("\n");
        let next = lines;
        if (Number(plan.is_free) === 1 && lines.includes("Branded affiliate portal") && !lines.includes(feature)) {
          next = lines.flatMap((l) => (l === "Branded affiliate portal" ? [feature, l] : [l]));
        } else if (Number(plan.is_free) !== 1 && lines.includes(feature)) {
          next = lines.filter((l) => l !== feature);
        }
        if (next !== lines) await db.updateTable("plans").set({ features: next.join("\n") }).where("id", "=", plan.id).execute();
      }
    },
    async down(db: AnyDb) {
      await db.schema.dropIndex("affiliates_program_coupon_idx").on("affiliates").execute();
      await db.schema.dropTable("adjustments").execute();
      await db.schema.alterTable("payouts").dropColumn("adjustment_cents").execute();
      await db.schema.dropIndex("conversions_program_charge_ref_idx").on("conversions").execute();
      await db.schema.dropIndex("conversions_program_payment_ref_idx").on("conversions").execute();
      await db.schema.alterTable("conversions").dropColumn("charge_ref").execute();
      await db.schema.alterTable("conversions").dropColumn("payment_ref").execute();
    },
  },
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
