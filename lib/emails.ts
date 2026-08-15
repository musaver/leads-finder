// Email discovery: pull contact emails out of a business website's HTML.
// Pure helpers only — fetching/crawling is orchestrated by lib/analyze.ts.

import * as cheerio from "cheerio";

const MAX_EMAILS = 3;

// Bound the plain-text regex scan: EMAIL_RE can backtrack quadratically on
// pathological input, and pages are attacker-controlled. mailto/cfemail
// extraction is DOM-based and unaffected by this cap.
const MAX_SCAN_CHARS = 1_000_000;

// The TLD must be all-lowercase or all-uppercase so a run-on like
// "support@foo.comCall us" splits at the case change ("foo.com" + "Call")
// instead of swallowing the next word into the domain. The uppercase
// branch needs the lookahead to get the same boundary protection.
const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:[a-z]{2,}|[A-Z]{2,}(?![A-Za-z]))/g;
const EMAIL_EXACT_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// Anti-spam spellings like "info [at] clinic [dot] com". Only bracketed
// markers are rewritten — bare "at"/"dot" words would fabricate addresses
// out of ordinary prose ("find us at chicago.com").
const OBFUSCATED_RE =
  /([a-z0-9._%+-]+)\s*[\[({]\s*at\s*[\])}]\s*([a-z0-9-]+(?:\.[a-z0-9-]+)*)\s*[\[({]\s*dot\s*[\])}]\s*([a-z]{2,})/gi;

// The regex happily matches asset filenames like "logo@2x.png".
const JUNK_ENDINGS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic", ".heif",
  ".svg", ".ico", ".bmp", ".tif", ".tiff",
  ".css", ".js", ".mjs", ".cjs", ".map", ".json", ".xml", ".html", ".htm",
  ".pdf", ".txt", ".zip", ".gz",
  ".mp3", ".mp4", ".m4a", ".m4v", ".wav", ".webm", ".mov", ".avi", ".mkv",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
];

// Placeholder and tooling domains that show up in page source but are
// never a real contact address for the business.
const JUNK_DOMAINS = [
  "example.com", "example.org", "example.net",
  "domain.com", "yourdomain.com", "yoursite.com", "yourcompany.com",
  "company.com", "mysite.com", "email.com", "address.com",
  "sentry.io", "wixpress.com", "sentry.wixpress.com",
  "schema.org", "w3.org",
];

// Addresses that exist but are useless for outreach.
const JUNK_LOCALPART_RE = /^(no-?reply|donotreply|mailer-daemon|postmaster|abuse)/;

// Path/text fragments that suggest a page likely lists contact details.
const CONTACT_HINTS = [
  "contact", "kontakt", "impressum", "get-in-touch", "getintouch",
  "reach-us", "reachus", "about",
];

function isPlausibleEmail(email: string): boolean {
  if (email.length > 254 || !EMAIL_EXACT_RE.test(email)) return false;
  // "%" is kept in the match regex so percent-encoded URL fragments are
  // consumed whole instead of yielding truncated matches — reject them here.
  if (email.includes("%")) return false;
  if (JUNK_ENDINGS.some((ext) => email.endsWith(ext))) return false;
  const [local, domain] = email.split("@");
  // Retina asset names: logo@2x.png, hero@1.5x.avif, ...
  if (/^\d+(?:\.\d+)?x\./.test(domain)) return false;
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return false;
  if (JUNK_LOCALPART_RE.test(local)) return false;
  return true;
}

// Entity-decoded page text with a space between text nodes. Cheerio's
// .text() concatenates adjacent nodes with no separator, which would glue
// neighboring text onto an address (<b>Email</b><p>info@x.com</p> →
// "Emailinfo@x.com") and fabricate a wrong local part.
interface DomNode {
  type: string;
  data?: string;
  name?: string;
  children?: DomNode[];
}

function decodedText($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  const walk = (node: DomNode) => {
    if (node.type === "text" && node.data) {
      parts.push(node.data);
      return;
    }
    if (node.name === "script" || node.name === "style") return;
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of $.root().toArray() as unknown as DomNode[]) walk(root);
  return parts.join(" ");
}

// Cloudflare email obfuscation: first hex byte is an XOR key for the rest.
function decodeCfEmail(hex: string): string | null {
  if (hex.length < 4 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return out;
}

/**
 * Extracts up to MAX_EMAILS plausible contact emails from a page.
 * mailto: links are collected first so the most intentional addresses
 * survive the cap.
 */
export function extractEmailsFromHtml(html: string, $: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    let addr = href.slice("mailto:".length).split("?")[0];
    try {
      addr = decodeURIComponent(addr);
    } catch {
      // keep the raw value if percent-decoding fails
    }
    found.add(addr.trim().toLowerCase());
  });

  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded) found.add(decoded.trim().toLowerCase());
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded) found.add(decoded.trim().toLowerCase());
  }

  for (const m of html.slice(0, MAX_SCAN_CHARS).matchAll(EMAIL_RE)) {
    found.add(m[0].toLowerCase());
  }

  // The raw-HTML pass misses entity-encoded addresses (info&#64;site.com);
  // the parsed DOM has them decoded. Also catch bracketed at/dot spellings.
  const text = decodedText($).slice(0, MAX_SCAN_CHARS);
  for (const m of text.matchAll(EMAIL_RE)) {
    found.add(m[0].toLowerCase());
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    found.add(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase());
  }

  return [...found].filter(isPlausibleEmail).slice(0, MAX_EMAILS);
}

/**
 * Conventional contact-page paths to try blind. JS-rendered sites often ship
 * a near-empty HTML shell with no nav links for findContactPageUrls to find,
 * but still serve /contact and /contact-us as real routes.
 */
export function guessContactUrls(baseUrl: string): string[] {
  try {
    const origin = new URL(baseUrl).origin;
    return [`${origin}/contact`, `${origin}/contact-us`];
  } catch {
    return [];
  }
}

/**
 * Same-site links that look like contact/about pages, best candidates first.
 */
export function findContactPageUrls(baseUrl: string, $: cheerio.CheerioAPI): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseHost = base.hostname.replace(/^www\./, "");

  const candidates: { url: string; rank: number }[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (resolved.hostname.replace(/^www\./, "") !== baseHost) return;

    const haystack =
      resolved.pathname.toLowerCase() + " " + $(el).text().trim().toLowerCase();
    const rank = CONTACT_HINTS.findIndex((hint) => haystack.includes(hint));
    if (rank === -1) return;

    // Dedupe ignoring hash, www., and trailing slash so /contact#form,
    // www variants, and /contact/ all collapse into one candidate.
    const normPath = (p: string) => p.replace(/\/+$/, "") || "/";
    const key = baseHost + normPath(resolved.pathname) + resolved.search;
    const baseKey = baseHost + normPath(base.pathname) + base.search;
    if (seen.has(key) || key === baseKey) return;
    seen.add(key);
    resolved.hash = "";
    candidates.push({ url: resolved.href, rank });
  });

  return candidates.sort((a, b) => a.rank - b.rank).map((c) => c.url);
}
