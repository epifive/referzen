/** Display helpers shared by server and client components. Dependency-free. */

/** Translator shape accepted by these helpers (server getT() and client useT() both fit). */
type T = (key: "pricing.unlimited") => string;

/** 0 → "Unlimited", otherwise a grouped number. */
export function formatLimit(value: number, t: T, locale?: string): string {
  return value ? value.toLocaleString(locale) : t("pricing.unlimited");
}
