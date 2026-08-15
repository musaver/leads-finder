// Shared types between the API route and the frontend.

export interface Lead {
  // Place data
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: number | null;
  reviewCount: number | null;
  placeId: string;
  googleMapsUrl: string;
  category: string;

  // Website analysis
  hasWebsite: boolean;
  siteStatus: "no_site" | "ok" | "fetch_failed" | "invalid_url";
  qualityScore: number;        // 0..9 — higher is better
  qualityReasons: string;      // comma-separated failed checks
  detectedBuilder: string;
  emails: string[];            // contact emails scraped from the website

  // Individual signals
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

export interface ScanRequest {
  query: string;
  location: string;
  maxResults: number;
  maxScore: number;
  apiKey?: string;
}

export type ScanEvent =
  | { type: "status"; message: string; total?: number }
  | { type: "lead"; index: number; total: number; lead: Lead; isLead: boolean }
  | { type: "done" }
  | { type: "error"; message: string };
