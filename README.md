# Lead Finder (Next.js)

Find businesses with no website or low-quality websites. Built on Next.js App Router with streaming API responses so leads appear live as they're scanned.

## Setup

1. **Bootstrap a Next.js project** (if you don't already have one):

   ```bash
   npx create-next-app@latest lead-finder --typescript --tailwind --app --src-dir=false --eslint --no-import-alias
   cd lead-finder
   ```

   Accept the defaults. The `@/*` import alias for the project root is already configured by `create-next-app`.

2. **Install the one extra dependency**:

   ```bash
   npm install cheerio
   ```

3. **Drop these files into the project**, replacing where they overlap:

   ```
   app/page.tsx
   app/api/scan/route.ts
   lib/types.ts
   lib/places.ts
   lib/analyze.ts
   .env.local.example
   ```

4. **Add your Google Maps API key**. Copy `.env.local.example` to `.env.local` and fill in the key. You need:
   - A Google Cloud project
   - **Places API (New)** enabled on it
   - A billing account attached (the API has a generous free tier)

   Create the key at <https://console.cloud.google.com/apis/credentials>.

5. **Run it**:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>.

## How it works

- **Frontend** (`app/page.tsx`) — React form for query/location/score threshold. Streams results into a live table.
- **API route** (`app/api/scan/route.ts`) — Server-side handler. Calls Places API, fetches each website, scores it, streams NDJSON events back to the client.
- **`lib/places.ts`** — Google Places (v1) Text Search client with pagination.
- **`lib/analyze.ts`** — Cheerio-based site analyzer. Same 9 quality checks as the Python version.

## Quality scoring (0–9)

A website earns one point for each of these passing:

| Check | What's tested |
|---|---|
| Responsive viewport | `<meta name="viewport">` exists |
| HTML5 doctype | `<!doctype html>` present |
| Modern layout | Few/no top-level `<table>` layouts + has semantic tags |
| Modern CSS framework | Bootstrap, Tailwind, Foundation, etc. detected |
| Clear CTA | "Call now", "Schedule", "Get a quote", etc. |
| Book/Order | "Book Now" or "Order Online" specifically |
| WhatsApp | wa.me / api.whatsapp.com link present |
| Form / lead capture | `<form>` element OR Typeform/Calendly embed |
| Pricing or services | Pricing keywords or services/menu section |

Any business scoring **at or below `maxScore`** (default 4) is exported as a lead. Businesses with no website are auto-included.

## Deployment notes

- **Vercel Hobby** caps function execution at 60s — fine for small scans, but the streaming response will cut off mid-scan for large queries. Use Pro (300s) or self-host for full 60-result scans.
- The `runtime = "nodejs"` and `maxDuration = 300` exports in the API route are already configured for this.
- For longer scans, consider running this as a worker queue (BullMQ / Inngest / Trigger.dev) instead of a sync request.

## Limits

- Google Text Search caps at ~60 results per query. For wider coverage, run multiple narrower searches (`"dentists in West Loop"`, `"dentists in Lincoln Park"`) and merge the CSVs.
- "Stock template look" and "inconsistent fonts/colors" can't be reliably detected from HTML. The proxy signals (no responsive design, table layouts, no HTML5) catch most of them. For visual review, add a Playwright screenshot pass on the worst-scoring sites.
- Site builder detection (Wix/Squarespace/etc.) is informational only — a Wix site can still be high-quality, so it doesn't dock points. Filter on `detectedBuilder` in the CSV separately if needed.
# leads-finder
# leads-finder
