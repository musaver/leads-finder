// Google Places API (v1 / "New") client.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

export interface PlaceResult {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  googleMapsUri?: string;
}

interface SearchTextResponse {
  places?: PlaceResult[];
  nextPageToken?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Paged text search. Google caps Text Search at ~60 results across 3 pages.
 */
export async function searchPlaces(
  apiKey: string,
  query: string,
  location: string,
  maxResults: number = 60,
): Promise<PlaceResult[]> {
  const fullQuery = `${query} in ${location}`;
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (results.length < maxResults && pageCount < 5) {
    const body: Record<string, unknown> = {
      textQuery: fullQuery,
      pageSize: Math.min(20, maxResults - results.length),
    };
    if (pageToken) {
      body.pageToken = pageToken;
      // Token needs ~2s to become valid
      await sleep(2000);
    }

    const resp = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Places API error ${resp.status}: ${errText}`);
    }

    const data: SearchTextResponse = await resp.json();
    const places = data.places ?? [];
    results.push(...places);
    pageToken = data.nextPageToken;
    pageCount++;
    if (!pageToken || places.length === 0) break;
  }

  return results.slice(0, maxResults);
}
