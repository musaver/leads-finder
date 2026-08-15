// POST /api/scan — streams NDJSON events as each business is processed.
// Each line of the response body is a JSON ScanEvent (see lib/types.ts).

import { NextRequest } from "next/server";
import { searchPlaces, PlaceResult } from "@/lib/places";
import { analyzeWebsite } from "@/lib/analyze";
import type { Lead, ScanRequest, ScanEvent } from "@/lib/types";

// Long-running scans need Node runtime (not Edge) and a generous timeout.
// On Vercel Hobby this still caps at 60s; bump your plan or self-host for longer scans.
export const runtime = "nodejs";
export const maxDuration = 300;

function buildLead(p: PlaceResult): Lead {
  const types = (p.types ?? []).filter(
    (t) => t !== "point_of_interest" && t !== "establishment",
  );
  return {
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    placeId: p.id,
    googleMapsUrl: p.googleMapsUri ?? "",
    category: types.join(", "),
    hasWebsite: !!p.websiteUri,
    siteStatus: p.websiteUri ? "ok" : "no_site",
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

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  let body: ScanRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = body.apiKey || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing API key. Set GOOGLE_MAPS_API_KEY or pass apiKey in the request." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { query, location, maxResults = 60, maxScore = 4, requireEmail = false } = body;
  if (!query || !location) {
    return new Response(JSON.stringify({ error: "query and location required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ScanEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      // Past this point, skip contact-page crawling so the scan itself can
      // still finish (and stream a clean "done") before the platform's
      // maxDuration kills the function mid-stream.
      const crawlDeadline = Date.now() + (maxDuration - 30) * 1000;

      try {
        send({ type: "status", message: `Searching Places for "${query}" in "${location}"...` });
        const places = await searchPlaces(apiKey, query, location, maxResults);
        send({
          type: "status",
          message: `Found ${places.length} businesses. Analyzing websites...`,
          total: places.length,
        });

        for (let i = 0; i < places.length; i++) {
          const p = places[i];
          const lead = buildLead(p);

          if (!lead.website) {
            // No website at all — automatic lead, unless an email is required
            // (there is no site to scrape one from).
            send({ type: "lead", index: i + 1, total: places.length, lead, isLead: !requireEmail });
            continue;
          }

          if (!isValidUrl(lead.website)) {
            lead.siteStatus = "invalid_url";
            send({ type: "lead", index: i + 1, total: places.length, lead, isLead: !requireEmail });
            continue;
          }

          try {
            const analysis = await analyzeWebsite(lead.website, {
              crawlContactPages: Date.now() < crawlDeadline,
            });
            Object.assign(lead, analysis);
          } catch {
            lead.siteStatus = "fetch_failed";
          }

          const isLead =
            lead.qualityScore <= maxScore &&
            (!requireEmail || lead.emails.length > 0);
          send({ type: "lead", index: i + 1, total: places.length, lead, isLead });
          await sleep(250);
        }

        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
