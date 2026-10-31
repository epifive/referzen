import "server-only";
import { isConversionSource, isConversionStatus } from "@/referral/normalize";
import type { ConversionFilters } from "./merchant-stats";

/** Conversion filters from the URL (?status=&source=&affiliate=&from=&to=&flagged=1&q=). */
export function conversionFiltersFrom(query: Record<string, string | string[] | undefined>): { filters: ConversionFilters; raw: Record<string, string | undefined> } {
  const one = (k: string) => {
    const v = query[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() ? s.trim().slice(0, 100) : undefined;
  };
  const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const status = one("status");
  const source = one("source");
  const affiliate = Number(one("affiliate"));
  const raw = {
    status: isConversionStatus(status) ? status : undefined,
    source: isConversionSource(source) ? source : undefined,
    affiliate: Number.isInteger(affiliate) && affiliate > 0 ? String(affiliate) : undefined,
    from: day(one("from")),
    to: day(one("to")),
    flagged: one("flagged") === "1" ? "1" : undefined,
    q: one("q"),
  };
  return {
    raw,
    filters: {
      status: raw.status,
      source: raw.source,
      affiliateId: raw.affiliate ? Number(raw.affiliate) : undefined,
      from: raw.from,
      to: raw.to,
      flagged: Boolean(raw.flagged),
      q: raw.q,
    },
  };
}

/** Query string of non-empty filter values (plus extra keys). */
export function filterQuery(raw: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
