// Website quality analyzer.
// Scores a URL 0..9 against the low-quality criteria. Higher = better.

import * as cheerio from "cheerio";
import {
  extractEmailsFromHtml,
  findContactPageUrls,
  guessContactUrls,
} from "./emails";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

const SITE_BUILDERS: Record<string, string> = {
  "wix.com": "Wix",
  "squarespace": "Squarespace",
  "godaddy": "GoDaddy",
  "weebly": "Weebly",
  "sitebuilder": "Sitebuilder",
  "duda": "Duda",
  "shopify": "Shopify",
  "wordpress": "WordPress",
  "webflow": "Webflow",
};

const CTA_KEYWORDS = [
  "book now", "book online", "order now", "order online",
  "call now", "schedule", "reserve", "buy now", "get a quote",
  "request a quote", "contact us", "request appointment",
  "make appointment", "get started",
];

const BOOK_OR_ORDER_KEYWORDS = [
  "book now", "book online", "order now", "order online", "reserve online",
];

const PRICING_KEYWORDS = [
  "pricing", "our prices", "rates", "menu", "$ ",
  "starting at", "from $",
];

const MODERN_CSS = [
  "bootstrap", "tailwind", "foundation", "bulma", "material", "chakra",
];

export interface SiteAnalysis {
  siteStatus: "ok" | "fetch_failed";
  qualityScore: number;
  qualityReasons: string;
  detectedBuilder: string;
  emails: string[];
  hasResponsiveViewport: boolean;
  html5Doctype: boolean;
  usesModernLayout: boolean;
  modernCssFramework: boolean;
  hasClearCta: boolean;
  hasBookOrOrder: boolean;
  hasWhatsapp: boolean;
  hasForm: boolean;
  hasPricingOrServices: boolean;
}

function emptyAnalysis(): SiteAnalysis {
  return {
    siteStatus: "fetch_failed",
    qualityScore: 0,
    qualityReasons: "",
    detectedBuilder: "",
    emails: [],
    hasResponsiveViewport: false,
    html5Doctype: false,
    usesModernLayout: false,
    modernCssFramework: false,
    hasClearCta: false,
    hasBookOrOrder: false,
    hasWhatsapp: false,
    hasForm: false,
    hasPricingOrServices: false,
  };
}

async function fetchHtml(
  url: string,
  timeoutMs = 12000,
): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      // Look like a real browser navigation — bare UA + "Accept: text/html"
      // trips naive bot filters that a fuller header set passes.
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.toLowerCase().includes("html")) return null;
    return { html: await resp.text(), finalUrl: resp.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Homepage first; if it exposes no email, try the most contact-looking pages.
// The crawl runs inside a sequential per-lead scan loop, so its latency
// multiplies across leads: fetch both candidates in parallel with a short
// timeout, and let the caller skip the crawl entirely when time is short.
async function discoverEmails(
  pageUrl: string,
  html: string,
  $: cheerio.CheerioAPI,
  crawlContactPages: boolean,
): Promise<string[]> {
  const fromHomepage = extractEmailsFromHtml(html, $);
  if (fromHomepage.length > 0 || !crawlContactPages) return fromHomepage;

  // Links found on the page rank first; conventional paths (/contact,
  // /contact-us) fill the remaining slots — JS-shell pages expose no links
  // server-side, so without the guesses they would never be crawled.
  const norm = (u: string) => u.replace(/\/+$/, "").replace("://www.", "://");
  const candidates = findContactPageUrls(pageUrl, $);
  for (const guess of guessContactUrls(pageUrl)) {
    if (!candidates.some((c) => norm(c) === norm(guess))) candidates.push(guess);
  }

  const pages = await Promise.all(
    candidates.slice(0, 2).map((contactUrl) => fetchHtml(contactUrl, 4000)),
  );
  for (const page of pages) {
    if (!page) continue;
    const emails = extractEmailsFromHtml(page.html, cheerio.load(page.html));
    if (emails.length > 0) return emails;
  }
  return [];
}

export async function analyzeWebsite(
  url: string,
  opts: { crawlContactPages?: boolean } = {},
): Promise<SiteAnalysis> {
  const result = emptyAnalysis();
  const fetched = await fetchHtml(url);
  if (!fetched) {
    result.qualityReasons = "could_not_fetch_site";
    return result;
  }
  const { html, finalUrl } = fetched;

  result.siteStatus = "ok";
  const $ = cheerio.load(html);
  const htmlLower = html.toLowerCase();
  const textLower = $.root().text().toLowerCase();

  // 1. Responsive viewport
  result.hasResponsiveViewport = $('meta[name="viewport"]').length > 0;

  // 2. HTML5 doctype
  result.html5Doctype = /<!doctype\s+html\s*>/i.test(html);

  // 3. Modern layout: not heavily table-based, has semantic tags
  const topLevelTables = $("table").filter(
    (_, el) => $(el).parents("table").length === 0,
  ).length;
  const semanticTags = $("header, main, nav, section, article, footer").length;
  result.usesModernLayout = topLevelTables <= 1 && semanticTags >= 2;

  // 4. Modern CSS framework signature
  result.modernCssFramework = MODERN_CSS.some((fw) => htmlLower.includes(fw));

  // 5. Clear CTA anywhere on page
  result.hasClearCta = CTA_KEYWORDS.some((kw) => textLower.includes(kw));

  // 6. Book Now / Order Online specifically
  result.hasBookOrOrder = BOOK_OR_ORDER_KEYWORDS.some((kw) => textLower.includes(kw));

  // 7. WhatsApp link or icon
  const whatsappSignals = [
    "wa.me/", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com/send",
  ];
  result.hasWhatsapp = whatsappSignals.some((s) => htmlLower.includes(s));

  // 8. Lead-capture form
  result.hasForm =
    $("form").length > 0 ||
    htmlLower.includes("typeform.com") ||
    htmlLower.includes("calendly.com");

  // 9. Visible pricing or services list
  const hasPriceWords = PRICING_KEYWORDS.some((kw) => textLower.includes(kw));
  const hasServicesSection = /\b(services|menu|treatments|packages)\b/.test(textLower);
  result.hasPricingOrServices = hasPriceWords || hasServicesSection;

  // Site builder detection (informational)
  for (const [sig, name] of Object.entries(SITE_BUILDERS)) {
    if (htmlLower.includes(sig)) {
      result.detectedBuilder = name;
      break;
    }
  }

  const checks: [string, boolean][] = [
    ["not_responsive", result.hasResponsiveViewport],
    ["no_html5_doctype", result.html5Doctype],
    ["table_layout_or_no_semantics", result.usesModernLayout],
    ["no_modern_css_framework", result.modernCssFramework],
    ["no_clear_cta", result.hasClearCta],
    ["no_book_or_order", result.hasBookOrOrder],
    ["no_whatsapp", result.hasWhatsapp],
    ["no_form", result.hasForm],
    ["no_pricing_or_services", result.hasPricingOrServices],
  ];
  result.qualityScore = checks.filter(([, ok]) => ok).length;
  result.qualityReasons = checks
    .filter(([, ok]) => !ok)
    .map(([r]) => r)
    .join(", ");

  // Contact emails (informational, not part of the score)
  result.emails = await discoverEmails(
    finalUrl,
    html,
    $,
    opts.crawlContactPages !== false,
  );

  return result;
}
