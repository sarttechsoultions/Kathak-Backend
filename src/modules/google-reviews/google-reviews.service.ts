import { env } from "../../config/env";

export interface GoogleReview {
  id: string;
  quote: string;
  name: string;
  role: string;
  rating: number;
  photoUrl?: string;
}

export interface GoogleReviewsPayload {
  reviews: GoogleReview[];
  rating: number;
  totalRatings: number;
}

export type GoogleReviewsErrorCode =
  | "MISSING_API_KEY"
  | "PLACE_NOT_FOUND"
  | "PLACE_DETAILS_FAILED"
  | "NO_REVIEWS"
  | "API_PERMISSION_DENIED"
  | "API_NOT_ENABLED";

export interface GoogleReviewsResult {
  data: GoogleReviewsPayload | null;
  error?: GoogleReviewsErrorCode;
  details?: string;
}

interface LegacyPlaceReview {
  author_name?: string;
  profile_photo_url?: string;
  rating?: number;
  relative_time_description?: string;
  text?: string;
  time?: number;
}

interface LegacyPlaceDetailsResponse {
  status: string;
  result?: {
    name?: string;
    rating?: number;
    user_ratings_total?: number;
    reviews?: LegacyPlaceReview[];
  };
  error_message?: string;
}

interface LegacyFindPlaceResponse {
  status: string;
  candidates?: Array<{ place_id?: string }>;
  error_message?: string;
}

interface LegacyTextSearchResponse {
  status: string;
  results?: Array<{ place_id?: string }>;
  error_message?: string;
}

const LEGACY_PLACES_API_BASE = "https://maps.googleapis.com/maps/api/place";
const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedPayload: GoogleReviewsPayload | null = null;
let cacheExpiresAt = 0;

function mapGoogleError(status?: string, message?: string): GoogleReviewsErrorCode {
  const combined = `${status || ""} ${message || ""}`.toLowerCase();

  if (combined.includes("request_denied") && combined.includes("referrer")) {
    return "API_PERMISSION_DENIED";
  }

  if (
    combined.includes("request_denied") ||
    combined.includes("not enabled") ||
    combined.includes("legacy")
  ) {
    return "API_NOT_ENABLED";
  }

  if (combined.includes("zero_results") || combined.includes("not_found")) {
    return "PLACE_NOT_FOUND";
  }

  return "PLACE_DETAILS_FAILED";
}

async function resolvePlaceId(apiKey: string): Promise<{
  placeId: string | null;
  error?: GoogleReviewsErrorCode;
  details?: string;
}> {
  if (env.googlePlaceId) {
    return { placeId: env.googlePlaceId };
  }

  const query = encodeURIComponent(env.googlePlaceQuery);
  const findPlaceUrl = `${LEGACY_PLACES_API_BASE}/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id&key=${apiKey}`;
  const findPlaceResponse = await fetch(findPlaceUrl);
  const findPlaceData = (await findPlaceResponse.json()) as LegacyFindPlaceResponse;

  if (findPlaceData.status === "OK" && findPlaceData.candidates?.[0]?.place_id) {
    return { placeId: findPlaceData.candidates[0].place_id };
  }

  const textSearchUrl = `${LEGACY_PLACES_API_BASE}/textsearch/json?query=${query}&key=${apiKey}`;
  const textSearchResponse = await fetch(textSearchUrl);
  const textSearchData = (await textSearchResponse.json()) as LegacyTextSearchResponse;

  if (textSearchData.status === "OK" && textSearchData.results?.[0]?.place_id) {
    return { placeId: textSearchData.results[0].place_id };
  }

  const details =
    findPlaceData.error_message ||
    textSearchData.error_message ||
    `Find Place: ${findPlaceData.status}, Text Search: ${textSearchData.status}`;

  return {
    placeId: null,
    error: mapGoogleError(findPlaceData.status, details),
    details,
  };
}

function mapReviews(reviews: LegacyPlaceReview[] = []): GoogleReview[] {
  return reviews
    .filter((review) => review.text?.trim())
    .map((review, index) => ({
      id: `${review.author_name || "review"}-${review.time || index}`,
      quote: review.text!.trim(),
      name: review.author_name || "Google Reviewer",
      role: review.relative_time_description || "Google Review",
      rating: review.rating ?? 5,
      photoUrl: review.profile_photo_url,
    }));
}

export async function fetchGoogleReviews(): Promise<GoogleReviewsResult> {
  if (!env.googlePlacesApiKey) {
    return {
      data: null,
      error: "MISSING_API_KEY",
      details: "GOOGLE_PLACES_API_KEY is not configured in backend/.env",
    };
  }

  if (cachedPayload && Date.now() < cacheExpiresAt) {
    return { data: cachedPayload };
  }

  const resolved = await resolvePlaceId(env.googlePlacesApiKey);
  if (!resolved.placeId) {
    return {
      data: null,
      error: resolved.error || "PLACE_NOT_FOUND",
      details: resolved.details,
    };
  }

  const fields = encodeURIComponent("name,rating,user_ratings_total,reviews");
  const detailsUrl = `${LEGACY_PLACES_API_BASE}/details/json?place_id=${resolved.placeId}&fields=${fields}&key=${env.googlePlacesApiKey}`;
  const detailsResponse = await fetch(detailsUrl);
  const detailsData = (await detailsResponse.json()) as LegacyPlaceDetailsResponse;

  if (detailsData.status !== "OK" || !detailsData.result) {
    return {
      data: null,
      error: mapGoogleError(detailsData.status, detailsData.error_message),
      details: detailsData.error_message || `Place Details status: ${detailsData.status}`,
    };
  }

  const reviews = mapReviews(detailsData.result.reviews);
  if (reviews.length === 0) {
    return {
      data: null,
      error: "NO_REVIEWS",
      details: "Google returned the place but no public review text was available.",
    };
  }

  const payload: GoogleReviewsPayload = {
    reviews,
    rating: detailsData.result.rating ?? 4.9,
    totalRatings: detailsData.result.user_ratings_total ?? reviews.length,
  };

  cachedPayload = payload;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  return { data: payload };
}
