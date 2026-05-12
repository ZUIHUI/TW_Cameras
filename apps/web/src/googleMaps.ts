import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { GoogleRestaurantItem } from "./types";

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";
const DEFAULT_RESTAURANT_RADIUS_METERS = 3000;
const GOOGLE_RESTAURANT_LIMIT = 8;

let configuredApiKey = "";
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | undefined;
let placesLibraryPromise: Promise<google.maps.PlacesLibrary> | undefined;

function configureGoogleMaps(apiKey: string) {
  if (configuredApiKey === apiKey) {
    return;
  }

  setOptions({
    key: apiKey,
    language: "zh-TW",
    region: "TW",
    v: "weekly"
  });
  configuredApiKey = apiKey;
  mapsLibraryPromise = undefined;
  placesLibraryPromise = undefined;
}

export function loadGoogleMaps(apiKey = GOOGLE_MAPS_API_KEY) {
  configureGoogleMaps(apiKey);
  mapsLibraryPromise ||= importLibrary("maps");
  return mapsLibraryPromise;
}

export function loadGooglePlaces(apiKey = GOOGLE_MAPS_API_KEY) {
  configureGoogleMaps(apiKey);
  placesLibraryPromise ||= importLibrary("places");
  return placesLibraryPromise;
}

export async function searchGoogleNearbyRestaurants(
  origin: { lat: number; lon: number },
  radiusMeters = DEFAULT_RESTAURANT_RADIUS_METERS
): Promise<GoogleRestaurantItem[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    return [];
  }

  const { Place, SearchNearbyRankPreference } = await loadGooglePlaces();
  const { places } = await Place.searchNearby({
    fields: [
      "id",
      "displayName",
      "formattedAddress",
      "googleMapsURI",
      "location",
      "rating",
      "userRatingCount",
      "priceLevel",
      "businessStatus"
    ],
    includedPrimaryTypes: ["restaurant"],
    language: "zh-TW",
    locationRestriction: {
      center: { lat: origin.lat, lng: origin.lon },
      radius: radiusMeters
    },
    maxResultCount: GOOGLE_RESTAURANT_LIMIT,
    rankPreference: SearchNearbyRankPreference.POPULARITY,
    region: "TW"
  });

  return places
    .map((place) => normalizeGoogleRestaurant(place, origin))
    .filter((item): item is GoogleRestaurantItem => Boolean(item))
    .slice(0, GOOGLE_RESTAURANT_LIMIT);
}

function normalizeGoogleRestaurant(
  place: google.maps.places.Place,
  origin: { lat: number; lon: number }
): GoogleRestaurantItem | undefined {
  const location = place.location;
  const title = place.displayName?.trim();

  if (!location || !title) {
    return undefined;
  }

  const lat = location.lat();
  const lon = location.lng();
  const googleMapsUrl = place.googleMapsURI || googleMapsSearchUrl({ lat, lon, title });

  return {
    id: `google:${place.id || `${title}:${lat.toFixed(5)}:${lon.toFixed(5)}`}`,
    type: "restaurant",
    source: "Google Places",
    title,
    address: place.formattedAddress || "",
    distanceMeters: Math.round(distanceMeters(origin, { lat, lon })),
    lat,
    lon,
    googleMapsUrl,
    rating: place.rating ?? undefined,
    userRatingCount: place.userRatingCount ?? undefined,
    priceLevel: place.priceLevel ?? undefined,
    businessStatus: place.businessStatus ?? undefined
  };
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
