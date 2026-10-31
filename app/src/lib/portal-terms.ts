import "server-only";
import { renderMarkdown } from "./markdown";

/**
 * Program terms / introduction written by the merchant (Markdown). Raw HTML is escaped by
 * renderMarkdown(); links and images are limited to http(s), mailto and relative URLs so a
 * merchant can't put script URLs in front of their affiliates.
 */
export async function renderMerchantMarkdown(source: string): Promise<string> {
  if (!source.trim()) return "";
  const html = await renderMarkdown(source);
  return html
    .replace(/\s(href|src)="([^"]*)"/gi, (_match, attr: string, url: string) => {
      const value = url.replace(/&amp;/g, "&").trim();
      const safe = /^(https?:|mailto:)/i.test(value) || (/^[/#]/.test(value) && !value.startsWith("//"));
      return ` ${attr}="${safe ? url : "#"}"`;
    })
    .replace(/<a /g, '<a rel="nofollow noopener" target="_blank" ');
}
