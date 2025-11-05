// lib/template.ts

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Super-simple mustache-style template renderer.
 * Replaces {{key}} with the corresponding value from `vars`.
 */
export function renderTemplate(
  tpl: string | null | undefined,
  vars: TemplateVars
): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

/**
 * Admin-friendly "plain" formatting to HTML:
 * - Converts raw newlines to <br>
 * - Unescapes a small allow-list of tags that admins may type literally
 *   (e.g., <br>, <strong>, <em>, <b>, <i>, <u>)
 * This keeps the email looking like "plain text" but preserves intended breaks/emphasis.
 */
export function normalizeAdminTemplate(htmlish: string): string {
  if (!htmlish) return "";

  // 1) Convert CRLF/CR to LF
  let s = htmlish.replace(/\r\n?/g, "\n");

  // 2) If user typed literal HTML and it got escaped (&lt;...&gt;), unescape a safe allow-list
  //    NOTE: This ONLY unescapes these tags; everything else remains escaped.
  const unescapeTag = (tag: string) =>
    new RegExp(`&lt;\\/?${tag}\\b([^&]*)&gt;`, "gi");

  const allowList = ["br", "strong", "em", "b", "i", "u"];
  for (const tag of allowList) {
    s = s.replace(unescapeTag(tag), (_m, attrs) => {
      const hasSlash = /&lt;\/\s*${tag}\s*&gt;/i.test(_m);
      // crude check; easier to just reconstruct:
      if (/^&lt;\//.test(_m)) return `</${tag}>`;
      return `<${tag}${attrs ?? ""}>`;
    });
  }

  // 3) Convert remaining literal entities for <br> variants that might appear
  s = s
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&amp;nbsp;/gi, "&nbsp;");

  // 4) Convert plain newlines to <br> (so admin can just press Enter)
  //    (We already unescaped explicit <br>, this just handles plain text breaks.)
  s = s.replace(/\n/g, "<br>");

  return s;
}

/**
 * Format an ISO date string as a local date (e.g., "Oct 30, 2025").
 */
export function formatDate(
  iso: string,
  locale = "en-US",
  timeZone = "America/New_York"
): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone,
  }).format(d);
}

/**
 * Format an ISO date string as a local time (e.g., "5:30 PM").
 */
export function formatTime(
  iso: string,
  locale = "en-US",
  timeZone = "America/New_York"
): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);
}

