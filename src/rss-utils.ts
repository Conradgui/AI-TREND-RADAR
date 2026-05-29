/**
 * Shared RSS/XML parsing utilities for Chinese data sources.
 */

/** Extract the text content of the first occurrence of an XML tag. */
export function extractTag(xml: string, tag: string): string {
  const start = xml.indexOf(`<${tag}`);
  if (start === -1) return "";
  const gtIdx = xml.indexOf(">", start);
  if (gtIdx === -1) return "";
  const end = xml.indexOf(`</${tag}>`, gtIdx);
  if (end === -1) return "";
  return xml.slice(gtIdx + 1, end).trim();
}

/** Extract the CDATA content of the first occurrence of an XML tag. */
export function extractCdata(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const m = xml.match(re);
  if (m) return m[1]!.trim();
  return extractTag(xml, tag);
}

/** Strip HTML tags and decode common HTML entities. */
export function stripHtml(html: string, maxLen = 500): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .slice(0, maxLen);
}

/** Default fetch timeout in milliseconds. */
export const FETCH_TIMEOUT_MS = 30_000;
