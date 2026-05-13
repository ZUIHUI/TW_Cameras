import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { fetchJson } from "../http.js";
import type { RainfallStation, RainfallSummary } from "../types.js";

const RAINFALL_TTL_MS = 7 * 60 * 1000;
const RAINFALL_DATASET_ID = "O-A0002-001";
const RAINFALL_API_URL = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${RAINFALL_DATASET_ID}`;
const DEFAULT_RADIUS_METERS = 15_000;
const DEFAULT_LIMIT = 8;
const MAX_RADIUS_METERS = 80_000;
const MAX_LIMIT = 30;

export interface RainfallQuery {
  lat: number;
  lon: number;
  radiusMeters: number;
  limit: number;
}

export function parseRainfallQuery(query: {
  lat?: string;
  lon?: string;
  radius?: string;
  limit?: string;
}): { ok: true; value: RainfallQuery } | { ok: false; message: string } {
  const lat = Number(query.lat);
  const lon = Number(query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isTaiwanCoordinate(lat, lon)) {
    return { ok: false, message: "lat and lon must be valid Taiwan coordinates" };
  }

  const rawRadius = Number(query.radius || DEFAULT_RADIUS_METERS);
  const rawLimit = Number(query.limit || DEFAULT_LIMIT);

  return {
    ok: true,
    value: {
      lat,
      lon,
      radiusMeters: clamp(Number.isFinite(rawRadius) ? rawRadius : DEFAULT_RADIUS_METERS, 500, MAX_RADIUS_METERS),
      limit: Math.round(clamp(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1, MAX_LIMIT))
    }
  };
}

export async function getNearbyRainfallSummary(query: RainfallQuery) {
  const key = `cwa-rainfall:${query.lat.toFixed(3)}:${query.lon.toFixed(3)}:${query.radiusMeters}:${query.limit}`;
  return timedCache.getOrSet(key, RAINFALL_TTL_MS, () => loadNearbyRainfallSummary(query));
}

async function loadNearbyRainfallSummary(query: RainfallQuery): Promise<RainfallSummary> {
  if (!config.cwaApiKey) {
    throw new Error("Missing CWA_API_KEY");
  }

  const url = new URL(RAINFALL_API_URL);
  url.searchParams.set("Authorization", config.cwaApiKey);
  url.searchParams.set("format", "JSON");

  const payload = await fetchJson<unknown>(url.toString(), {}, 20000);
  const stations = pickStationRows(payload)
    .map((row) => normalizeRainfallStation(row, query))
    .filter((station): station is RainfallStation => Boolean(station))
    .filter((station) => station.distanceMeters <= query.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, query.limit);

  return {
    origin: {
      lat: query.lat,
      lon: query.lon,
      radiusMeters: query.radiusMeters
    },
    stations,
    updatedAt: new Date().toISOString()
  };
}

function normalizeRainfallStation(row: unknown, origin: { lat: number; lon: number }): RainfallStation | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const stationId = firstDeepString(row, ["StationId", "StationID", "stationId", "station_id"]);
  const stationName = firstDeepString(row, ["StationName", "stationName", "station_name"]);
  const county = firstDeepString(row, ["CountyName", "countyName", "County", "county"]);
  const town = firstDeepString(row, ["TownName", "townName", "Town", "town"]);
  const coordinate = firstTaiwanCoordinate(row);
  const obsTime = firstDeepString(row, ["DateTime", "ObsTime_DateTime", "obsTime", "DataTime", "RecordTime"]);

  if (!stationId || !stationName || !coordinate) {
    return undefined;
  }

  return {
    stationId,
    stationName,
    county,
    town,
    lat: coordinate.lat,
    lon: coordinate.lon,
    distanceMeters: Math.round(distanceKm(origin, coordinate) * 1000),
    obsTime: obsTime || new Date().toISOString(),
    rain10Min: findRainValue(row, ["past10min", "10min", "10minute"]),
    rain1Hour: findRainValue(row, ["past1hr", "past1hour", "1hr", "1hour"]),
    rain3Hour: findRainValue(row, ["past3hr", "past3hour", "3hr", "3hour"]),
    rain24Hour: findRainValue(row, ["past24hr", "past24hour", "24hr", "24hour"]),
    updatedAt: new Date().toISOString()
  };
}

function pickStationRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }

  const direct = firstArrayByKeys(payload, ["Station", "Stations", "station", "stations", "records", "Records"]);
  if (direct.length) {
    return direct;
  }

  return deepRecords(payload).filter((record) => firstDeepString(record, ["StationId", "StationID"]) && firstTaiwanCoordinate(record));
}

function firstArrayByKeys(payload: unknown, keys: string[]): unknown[] {
  const expected = new Set(keys.map(normalizeKey));
  const queue = [payload];

  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (expected.has(normalizeKey(key)) && Array.isArray(value)) {
        return value;
      }
      queue.push(value);
    }
  }

  return [];
}

function firstDeepString(payload: unknown, keys: string[]): string {
  const expected = new Set(keys.map(normalizeKey));
  for (const entry of flattenValues(payload)) {
    if (expected.has(entry.key) && (typeof entry.value === "string" || typeof entry.value === "number")) {
      const value = String(entry.value).trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function firstTaiwanCoordinate(payload: unknown): { lat: number; lon: number } | undefined {
  const entries = flattenValues(payload);
  const latitudes = entries.filter((entry) => isLatitudeKey(entry.key)).map((entry) => toNumber(entry.value));
  const longitudes = entries.filter((entry) => isLongitudeKey(entry.key)).map((entry) => toNumber(entry.value));

  for (const lat of latitudes) {
    if (lat === undefined) continue;
    for (const lon of longitudes) {
      if (lon !== undefined && isTaiwanCoordinate(lat, lon)) {
        return { lat, lon };
      }
    }
  }

  return undefined;
}

function findRainValue(payload: unknown, tokens: string[]): number | undefined {
  const normalizedTokens = tokens.map(normalizeKey);
  const candidates = flattenValues(payload).filter((entry) => {
    const path = entry.path.join(".");
    return (
      normalizedTokens.some((token) => path.includes(token)) &&
      (path.includes("precipitation") || path.includes("rainfall") || path.includes("rain"))
    );
  });

  for (const entry of candidates) {
    const value = toRainNumber(entry.value);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function flattenValues(payload: unknown): Array<{ key: string; path: string[]; value: unknown }> {
  const values: Array<{ key: string; path: string[]; value: unknown }> = [];
  collectValues(payload, [], values);
  return values;
}

function collectValues(payload: unknown, path: string[], values: Array<{ key: string; path: string[]; value: unknown }>) {
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => collectValues(item, [...path, String(index)], values));
    return;
  }

  if (!isRecord(payload)) {
    return;
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = normalizeKey(key);
    const nextPath = [...path, normalizedKey];
    values.push({ key: normalizedKey, path: nextPath, value });
    collectValues(value, nextPath, values);
  }
}

function deepRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap(deepRecords);
  }
  if (!isRecord(payload)) {
    return [];
  }

  return [payload, ...Object.values(payload).flatMap(deepRecords)];
}

function isLatitudeKey(key: string) {
  return key === "lat" || key === "latitude" || key.endsWith("latitude") || key.includes("stationlatitude");
}

function isLongitudeKey(key: string) {
  return (
    key === "lon" ||
    key === "lng" ||
    key === "longitude" ||
    key.endsWith("longitude") ||
    key.includes("stationlongitude")
  );
}

function toRainNumber(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim().toUpperCase() === "T") {
    return 0;
  }

  const parsed = toNumber(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function distanceKm(origin: { lat: number; lon: number }, item: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const dLat = toRad(item.lat - origin.lat);
  const dLon = toRad(item.lon - origin.lon);
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(item.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isTaiwanCoordinate(lat: number, lon: number): boolean {
  return lat >= 20 && lat <= 27 && lon >= 118 && lon <= 123;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s|_|-/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
