import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";

let configuredApiKey = "";
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | undefined;

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
}

export function loadGoogleMaps(apiKey = GOOGLE_MAPS_API_KEY) {
  configureGoogleMaps(apiKey);
  mapsLibraryPromise ||= importLibrary("maps");
  return mapsLibraryPromise;
}
