import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { fetchJson, UpstreamError } from "../http.js";
import type { GoogleRestaurantItem, PlacePrediction, SearchPlace } from "../types.js";

const PLACES_API_BASE_URL = "https://places.googleapis.com/v1";
const GOOGLE_RESTAURANT_LIMIT = 8;
const DEFAULT_RADIUS_METERS = 3000;
const MIN_RADIUS_METERS = 1000;
const MAX_RADIUS_METERS = 10000;
const NEARBY_RESTAURANTS_TTL_MS = 15 * 60 * 1000;
const PLACE_DETAILS_TTL_MS = 60 * 60 * 1000;

const nearbyRestaurantFieldMask = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.businessStatus"
].join(",");

const autocompleteFieldMask = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text"
].join(",");

const placeDetailsFieldMask = ["id", "displayName", "formattedAddress", "location"].join(",");

export interface NearbyRestaurantsQuery {
  lat: number;
  lon: number;
  radius: number;
}

export type NearbyRestaurantsQueryResult =
  | { ok: true; value: NearbyRestaurantsQuery }
  | { ok: false; message: string };

export type PlaceAutocompleteQueryResult =
  | { ok: true; value: { input: string } }
  | { ok: false; message: string };

export type PlaceDetailsQueryResult =
  | { ok: true; value: { placeId: string } }
  | { ok: false; message: string };

interface GoogleNearbySearchResponse {
  places?: GooglePlace[];
}

interface GoogleAutocompleteResponse {
  suggestions?: GoogleAutocompleteSuggestion[];
}

interface GoogleAutocompleteSuggestion {
  placePrediction?: GooglePlacePrediction;
}

interface GooglePlacePrediction {
  placeId?: string;
  text?: {
    text?: string;
  };
  structuredFormat?: {
    mainText?: {
      text?: string;
    };
    secondaryText?: {
      text?: string;
    };
  };
}

interface GooglePlace {
  id?: string;
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  googleMapsUri?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
}

export function parseNearbyRestaurantsQuery(input: {
  lat?: string | null;
  lon?: string | null;
  radius?: string | null;
}): NearbyRestaurantsQueryResult {
  const lat = Number(input.lat);
  const lon = Number(input.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, message: "lat and lon must be valid coordinates." };
  }

  const requestedRadius = input.radius ? Number(input.radius) : DEFAULT_RADIUS_METERS;
  const radius = Number.isFinite(requestedRadius)
    ? Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(requestedRadius)))
    : DEFAULT_RADIUS_METERS;

  return {
    ok: true,
    value: { lat, lon, radius }
  };
}

export function parsePlaceAutocompleteQuery(input: { input?: string | null }): PlaceAutocompleteQueryResult {
  const query = input.input?.trim() || "";
  if (query.length < 2) {
    return { ok: false, message: "input must be at least 2 characters." };
  }

  return {
    ok: true,
    value: { input: query.slice(0, 160) }
  };
}

export function parsePlaceDetailsQuery(input: { placeId?: string | null }): PlaceDetailsQueryResult {
  const placeId = input.placeId?.trim() || "";
  if (!placeId || !/^[\w:.-]+$/.test(placeId)) {
    return { ok: false, message: "placeId is required." };
  }

  return {
    ok: true,
    value: { placeId }
  };
}

export async function getGoogleNearbyRestaurants(query: NearbyRestaurantsQuery): Promise<GoogleRestaurantItem[]> {
  const bucket = `${bucketCoordinate(query.lat)}:${bucketCoordinate(query.lon)}:${query.radius}`;
  const cached = await timedCache.getOrSet(`google-restaurants:${bucket}`, NEARBY_RESTAURANTS_TTL_MS, () =>
    loadGoogleNearbyRestaurants(query)
  );
  return cached.value;
}

export async function getGooglePlacePredictions(input: string): Promise<PlacePrediction[]> {
  const payload = await fetchJson<GoogleAutocompleteResponse>(
    `${PLACES_API_BASE_URL}/places:autocomplete`,
    {
      method: "POST",
      headers: googlePlacesHeaders(autocompleteFieldMask),
      body: JSON.stringify({
        input,
        includedRegionCodes: ["tw"],
        languageCode: "zh-TW",
        regionCode: "TW"
      })
    },
    10000
  );

  return (payload.suggestions || [])
    .map((suggestion) => normalizePlacePrediction(suggestion.placePrediction))
    .filter((prediction): prediction is PlacePrediction => Boolean(prediction))
    .slice(0, 5);
}

export async function getGooglePlaceDetails(placeId: string): Promise<SearchPlace> {
  const cached = await timedCache.getOrSet(`google-place-details:${placeId}`, PLACE_DETAILS_TTL_MS, () =>
    loadGooglePlaceDetails(placeId)
  );
  return cached.value;
}

async function loadGoogleNearbyRestaurants(query: NearbyRestaurantsQuery): Promise<GoogleRestaurantItem[]> {
  const payload = await fetchJson<GoogleNearbySearchResponse>(
    `${PLACES_API_BASE_URL}/places:searchNearby`,
    {
      method: "POST",
      headers: googlePlacesHeaders(nearbyRestaurantFieldMask),
      body: JSON.stringify({
        includedPrimaryTypes: ["restaurant"],
        languageCode: "zh-TW",
        locationRestriction: {
          circle: {
            center: {
              latitude: query.lat,
              longitude: query.lon
            },
            radius: query.radius
          }
        },
        maxResultCount: GOOGLE_RESTAURANT_LIMIT,
        rankPreference: "POPULARITY",
        regionCode: "TW"
      })
    },
    10000
  );

  return (payload.places || [])
    .map((place) => normalizeGoogleRestaurant(place, query))
    .filter((item): item is GoogleRestaurantItem => Boolean(item))
    .slice(0, GOOGLE_RESTAURANT_LIMIT);
}

async function loadGooglePlaceDetails(placeId: string): Promise<SearchPlace> {
  const url = new URL(`${PLACES_API_BASE_URL}/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", "zh-TW");
  url.searchParams.set("regionCode", "TW");

  const place = await fetchJson<GooglePlace>(
    url.toString(),
    {
      headers: googlePlacesHeaders(placeDetailsFieldMask)
    },
    10000
  );
  const normalized = normalizeSearchPlace(place, placeId);
  if (!normalized) {
    throw new UpstreamError("Google Place Details did not include a usable location.");
  }

  return normalized;
}

function normalizeGoogleRestaurant(
  place: GooglePlace,
  origin: { lat: number; lon: number }
): GoogleRestaurantItem | undefined {
  const coordinate = taiwanCoordinate(place.location?.latitude, place.location?.longitude);
  const title = place.displayName?.text?.trim();

  if (!title || !coordinate) {
    return undefined;
  }
  const { lat, lon } = coordinate;

  return {
    id: `google:${place.id || `${title}:${lat.toFixed(5)}:${lon.toFixed(5)}`}`,
    type: "restaurant",
    source: "Google Places",
    title,
    address: place.formattedAddress || "",
    distanceMeters: Math.round(distanceMeters(origin, { lat, lon })),
    lat,
    lon,
    googleMapsUrl: place.googleMapsUri || googleMapsSearchUrl({ lat, lon, title }),
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: place.priceLevel,
    businessStatus: place.businessStatus
  };
}

function normalizePlacePrediction(prediction: GooglePlacePrediction | undefined): PlacePrediction | undefined {
  const placeId = prediction?.placeId?.trim();
  const description = prediction?.text?.text?.trim() || "";
  const mainText = prediction?.structuredFormat?.mainText?.text?.trim() || description;
  const secondaryText = prediction?.structuredFormat?.secondaryText?.text?.trim() || "";

  if (!placeId || !mainText) {
    return undefined;
  }

  return {
    placeId,
    description: description || [mainText, secondaryText].filter(Boolean).join(" "),
    mainText,
    secondaryText
  };
}

function normalizeSearchPlace(place: GooglePlace, fallbackId: string): SearchPlace | undefined {
  const coordinate = taiwanCoordinate(place.location?.latitude, place.location?.longitude);
  const title = place.displayName?.text?.trim() || place.formattedAddress?.trim();

  if (!title || !coordinate) {
    return undefined;
  }
  const { lat, lon } = coordinate;

  return {
    id: place.id || fallbackId,
    title,
    address: place.formattedAddress || "",
    lat,
    lon
  };
}

function googlePlacesHeaders(fieldMask: string) {
  return {
    "content-type": "application/json",
    "X-Goog-Api-Key": googlePlacesApiKey(),
    "X-Goog-FieldMask": fieldMask
  };
}

function googlePlacesApiKey() {
  const key = config.googleMapsApiKey || config.googleGeocodingApiKey;
  if (!key) {
    throw new UpstreamError("GOOGLE_MAPS_API_KEY is not configured.", 503);
  }
  return key;
}

function googleMapsSearchUrl(item: { lat: number; lon: number; title?: string }) {
  const query = item.title ? `${item.title} ${item.lat},${item.lon}` : `${item.lat},${item.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function distanceMeters(origin: { lat: number; lon: number }, item: { lat: number; lon: number }) {
  const earthRadiusMeters = 6371000;
  const dLat = toRad(item.lat - origin.lat);
  const dLon = toRad(item.lon - origin.lon);
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(item.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function taiwanCoordinate(lat: number | undefined, lon: number | undefined): { lat: number; lon: number } | undefined {
  const valid =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat !== undefined &&
    lon !== undefined &&
    lat >= 20 &&
    lat <= 26.5 &&
    lon >= 118 &&
    lon <= 123;

  return valid ? { lat, lon } : undefined;
}

function bucketCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}
