// Email discovery: pull contact emails out of a business website's HTML.
// Pure helpers only — fetching/crawling is orchestrated by lib/analyze.ts.

import * as cheerio from "cheerio";

const MAX_EMAILS = 3;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_EXACT_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// The regex happily matches asset filenames like "logo@2x.png".
const JUNK_ENDINGS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".css", ".js", ".json", ".pdf", ".mp4", ".webm",
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
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return false;
  if (JUNK_LOCALPART_RE.test(local)) return false;
  return true;
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

  for (const m of html.matchAll(EMAIL_RE)) {
    found.add(m[0].toLowerCase());
  }

  return [...found].filter(isPlausibleEmail).slice(0, MAX_EMAILS);
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

    // Dedupe ignoring hash and www. so /contact#form and www variants collapse.
    const key = baseHost + resolved.pathname + resolved.search;
    const baseKey = baseHost + base.pathname + base.search;
    if (seen.has(key) || key === baseKey) return;
    seen.add(key);
    resolved.hash = "";
    candidates.push({ url: resolved.href, rank });
  });

  return candidates.sort((a, b) => a.rank - b.rank).map((c) => c.url);
}
