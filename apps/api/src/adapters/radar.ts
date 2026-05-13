import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { fetchJson, UpstreamError } from "../http.js";
import type { RadarOverlay } from "../types.js";

const RADAR_TTL_MS = 5 * 60 * 1000;
const RADAR_DATASET_ID = "O-A0058-006";
const RADAR_TITLE = "雷達整合回波圖";
const RADAR_FILE_API_URL = `https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${RADAR_DATASET_ID}`;
const RADAR_NEARBY_BOUNDS = {
  north: 26.5,
  south: 20.5,
  east: 124,
  west: 118
};

export async function getRadarOverlay() {
  return timedCache.getOrSet("cwa-radar-overlay", RADAR_TTL_MS, loadRadarOverlay);
}

async function loadRadarOverlay(): Promise<RadarOverlay> {
  if (!config.cwaApiKey) {
    throw new Error("Missing CWA_API_KEY");
  }

  const url = new URL(RADAR_FILE_API_URL);
  url.searchParams.set("Authorization", config.cwaApiKey);
  url.searchParams.set("format", "JSON");

  const payload = await fetchJson<unknown>(url.toString(), {}, 20000);
  const imageUrl = firstHttpValue(payload, ["ProductURL", "productURL", "uri", "URI", "url", "URL"]);
  if (!imageUrl) {
    throw new UpstreamError("CWA radar payload did not include an image URL");
  }

  return {
    datasetId: RADAR_DATASET_ID,
    title: RADAR_TITLE,
    imageUrl,
    mimeType: findParameterValue(payload, ["mimeType", "MimeType", "MIMEType"]) || mimeTypeFromUrl(imageUrl),
    dateTime:
      findParameterValue(payload, ["DateTime", "dateTime", "datetime", "timePosition", "時間"]) ||
      new Date().toISOString(),
    bounds: parseBounds(payload) || RADAR_NEARBY_BOUNDS,
    imageDimension: parseImageDimension(payload),
    updatedAt: new Date().toISOString()
  };
}

function parseBounds(payload: unknown): RadarOverlay["bounds"] | undefined {
  const lonRange = parseRange(findParameterValue(payload, ["LongitudeRange", "longitudeRange", "經度範圍", "經度"]));
  const latRange = parseRange(findParameterValue(payload, ["LatitudeRange", "latitudeRange", "緯度範圍", "緯度"]));
  if (!lonRange || !latRange) {
    return undefined;
  }

  return {
    west: lonRange.min,
    east: lonRange.max,
    south: latRange.min,
    north: latRange.max
  };
}

function parseImageDimension(payload: unknown): RadarOverlay["imageDimension"] | undefined {
  const value = findParameterValue(payload, ["ImageDimension", "imageDimension", "影像解析度", "解析度"]);
  const matches = value.match(/\d+/g)?.map(Number).filter(Number.isFinite);
  if (!matches || matches.length < 2) {
    return undefined;
  }

  return {
    width: matches[0],
    height: matches[1]
  };
}

function parseRange(value: string): { min: number; max: number } | undefined {
  const values = value.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite);
  if (!values || values.length < 2) {
    return undefined;
  }

  return {
    min: Math.min(values[0], values[1]),
    max: Math.max(values[0], values[1])
  };
}

function findParameterValue(payload: unknown, names: string[]): string {
  const direct = findStringByKeys(payload, names);
  if (direct) {
    return direct;
  }

  for (const record of deepRecords(payload)) {
    const parameterName = stringField(record, "parameterName", "ParameterName", "name", "Name");
    if (!matchesName(parameterName, names)) {
      continue;
    }

    const value = stringField(record, "parameterValue", "ParameterValue", "value", "Value");
    if (value) {
      return value;
    }
  }

  return "";
}

function firstHttpValue(payload: unknown, keys: string[]): string {
  for (const value of valuesByKeys(payload, keys)) {
    if (isHttpUrl(value)) {
      return value;
    }
  }
  return "";
}

function findStringByKeys(payload: unknown, keys: string[]): string {
  return valuesByKeys(payload, keys).find((value) => value.trim().length > 0) || "";
}

function valuesByKeys(payload: unknown, keys: string[]): string[] {
  const expected = new Set(keys.map(normalizeKey));
  const values: string[] = [];
  collectValuesByKeys(payload, expected, values);
  return values;
}

function collectValuesByKeys(payload: unknown, keys: Set<string>, values: string[]) {
  if (Array.isArray(payload)) {
    payload.forEach((item) => collectValuesByKeys(item, keys, values));
    return;
  }

  if (!isRecord(payload)) {
    return;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (keys.has(normalizeKey(key)) && (typeof value === "string" || typeof value === "number")) {
      values.push(String(value).trim());
    }
    collectValuesByKeys(value, keys, values);
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

function matchesName(value: string, names: string[]) {
  const normalizedValue = normalizeKey(value);
  return names.some((name) => {
    const normalizedName = normalizeKey(name);
    return normalizedValue === normalizedName || normalizedValue.includes(normalizedName);
  });
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function mimeTypeFromUrl(url: string) {
  return /\.png(?:$|\?)/i.test(url) ? "image/png" : "image/*";
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s|_|-/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
