import "server-only";

/** Small input helpers shared by the public endpoints (/api/click, /api/referral, /api/convert, /api/hooks/*, /api/v1/*). */

export class BodyTooLargeError extends Error {}

/** Read the request body as text, refusing anything larger than `maxBytes`. */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** JSON.parse that returns undefined instead of throwing. */
export function parseJsonText(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** A landing page path from rz.js: "/pricing" (no query, no hash), at most 255 characters. */
export function normalizePath(v: unknown): string {
  if (typeof v !== "string") return "/";
  let path = v.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  path = path.replace(/[\u0000-\u001F\u007F\s]/g, "");
  return path.slice(0, 255) || "/";
}
