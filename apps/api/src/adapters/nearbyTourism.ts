import { timedCache } from "../cache.js";
import { UpstreamError } from "../http.js";
import { tdxGet } from "../tdx.js";
import type { NearbyTourismItem, NearbyTourismSummary, TourismItemType } from "../types.js";

const NEARBY_TOURISM_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RADIUS_METERS = 3000;
const MIN_RADIUS_METERS = 1000;
const MAX_RADIUS_METERS = 10000;
const GROUP_LIMIT = 8;
const TDX_TOURISM_TOP_LIMIT = 500;
const TDX_TOURISM_DATASET_GAP_MS = 350;
const TDX_TOURISM_RETRY_DELAYS_MS = [1200, 2500];

interface TourismDatasetDefinition {
  type: TourismItemType;
  group: "attractions" | "restaurants" | "activities";
  source: string;
  endpoint: string;
  idFields: string[];
  titleFields: string[];
  descriptionFields: string[];
  endTimeFields?: string[];
}

type TourismCatalogItem = Omit<NearbyTourismItem, "distanceMeters"> & {
  endTime?: string;
};

export interface NearbyTourismQuery {
  lat: number;
  lon: number;
  radius: number;
}

export type NearbyTourismQueryResult =
  | { ok: true; value: NearbyTourismQuery }
  | { ok: false; message: string };

const tourismDatasets: TourismDatasetDefinition[] = [
  {
    type: "attraction",
    group: "attractions",
    source: "TDX Tourism V2.1 / 觀光署景點",
    endpoint: "/Tourism/Attraction",
    idFields: ["ScenicSpotID", "AttractionID", "ID", "Id"],
    titleFields: ["ScenicSpotName", "AttractionName", "Name"],
    descriptionFields: ["DescriptionDetail", "Description", "Remarks"]
  },
  {
    type: "restaurant",
    group: "restaurants",
    source: "TDX Tourism V2.1 / 觀光署餐飲",
    endpoint: "/Tourism/Restaurant",
    idFields: ["RestaurantID", "ID", "Id"],
    titleFields: ["RestaurantName", "Name"],
    descriptionFields: ["Description", "Remarks", "CuisineClasses"]
  },
  {
    type: "activity",
    group: "activities",
    source: "TDX Tourism V2.1 / 觀光署活動",
    endpoint: "/Tourism/Event",
    idFields: ["ActivityID", "EventID", "ID", "Id"],
    titleFields: ["ActivityName", "EventName", "Name"],
    descriptionFields: ["Description", "Remarks", "EventClasses"],
    endTimeFields: ["EndTime", "EndDateTime", "EndDate", "EndDateTime.DateTime"]
  }
];

export function parseNearbyTourismQuery(input: {
  lat?: string | null;
  lon?: string | null;
  radius?: string | null;
}): NearbyTourismQueryResult {
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

export async function getNearbyTourismSummary(query: NearbyTourismQuery) {
  const bucket = `${bucketCoordinate(query.lat)}:${bucketCoordinate(query.lon)}:${query.radius}`;
  return timedCache.getOrSet(`nearby-tourism:${bucket}`, NEARBY_TOURISM_TTL_MS, () => loadNearbyTourismSummary(query));
}

async function loadNearbyTourismSummary(query: NearbyTourismQuery): Promise<NearbyTourismSummary> {
  const origin = { lat: query.lat, lon: query.lon, radiusMeters: query.radius };
  const summary: NearbyTourismSummary = {
    origin,
    attractions: [],
    restaurants: [],
    activities: [],
    sourceErrors: [],
    updatedAt: new Date().toISOString()
  };

  for (const [index, dataset] of tourismDatasets.entries()) {
    try {
      summary[dataset.group] = nearbyItems(await loadTourismDataset(dataset, query), query);
    } catch (error) {
      summary.sourceErrors.push({
        source: dataset.source,
        endpoint: dataset.endpoint,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    if (index < tourismDatasets.length - 1) {
      await sleep(TDX_TOURISM_DATASET_GAP_MS);
    }
  }

  return summary;
}

async function loadTourismDataset(
  dataset: TourismDatasetDefinition,
  query: NearbyTourismQuery
): Promise<TourismCatalogItem[]> {
  const payload = await withTourismRetry(() =>
    tdxGet<unknown>(
      dataset.endpoint,
      {
        "$top": String(TDX_TOURISM_TOP_LIMIT),
        "$filter": tourismBoundingFilter(query)
      },
      { auth: "required", apiBase: "tourism-odata-v2" }
    )
  );
  const rows = pickArray(payload);
  return rows
    .map((row) => normalizeTourismItem(row, dataset))
    .filter((item): item is TourismCatalogItem => Boolean(item));
}

function tourismBoundingFilter(query: NearbyTourismQuery): string {
  const latDelta = query.radius / 111_320;
  const lonScale = Math.max(Math.cos(toRad(query.lat)), 0.01);
  const lonDelta = query.radius / (111_320 * lonScale);

  const minLat = query.lat - latDelta;
  const maxLat = query.lat + latDelta;
  const minLon = query.lon - lonDelta;
  const maxLon = query.lon + lonDelta;

  return [
    `PositionLat ge ${formatODataNumber(minLat)}`,
    `PositionLat le ${formatODataNumber(maxLat)}`,
    `PositionLon ge ${formatODataNumber(minLon)}`,
    `PositionLon le ${formatODataNumber(maxLon)}`
  ].join(" and ");
}

async function withTourismRetry<T>(loader: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= TDX_TOURISM_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await loader();
    } catch (error) {
      const shouldRetry = isRetryableTourismError(error) && attempt < TDX_TOURISM_RETRY_DELAYS_MS.length;
      if (!shouldRetry) throw error;
      await sleep(TDX_TOURISM_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error("TDX Tourism retry loop exited unexpectedly.");
}

function isRetryableTourismError(error: unknown): boolean {
  return error instanceof UpstreamError && [429, 500, 502, 503, 504].includes(error.status);
}

function normalizeTourismItem(row: unknown, dataset: TourismDatasetDefinition): TourismCatalogItem | undefined {
  if (!isRecord(row)) return undefined;

  const title = firstString(row, dataset.titleFields);
  const lat = firstNumber(row, ["PositionLat", "Position.PositionLat", "Position.Lat", "Latitude", "Py"]);
  const lon = firstNumber(row, ["PositionLon", "Position.PositionLon", "Position.Lon", "Longitude", "Px"]);

  if (!title || !isTaiwanCoordinate(lat, lon)) {
    return undefined;
  }

  const endTime = firstString(row, dataset.endTimeFields || []);
  if (dataset.type === "activity" && isPastActivity(endTime)) {
    return undefined;
  }

  const id =
    firstString(row, dataset.idFields) ||
    `${dataset.type}:${title}:${lat.toFixed(5)}:${lon.toFixed(5)}`.replace(/\s+/g, "-");
  const updatedAt = firstString(row, ["UpdateTime", "SrcUpdateTime", "UpdatedTime"]) || new Date().toISOString();

  return {
    id: `${dataset.type}:${id}`,
    type: dataset.type,
    title,
    description: trimDescription(firstString(row, dataset.descriptionFields)),
    address: firstAddress(row),
    phone: firstPhone(row),
    lat,
    lon,
    url: firstString(row, ["WebsiteURL", "WebsiteUrl", "Website", "Url", "MapURLs", "MapUrl", "SameAsURLs"]),
    imageUrl: firstImageUrl(row),
    updatedAt,
    endTime
  };
}

function nearbyItems(items: TourismCatalogItem[], query: NearbyTourismQuery): NearbyTourismItem[] {
  return items
    .map((item) => ({
      ...item,
      distanceMeters: Math.round(distanceMeters(query, item))
    }))
    .filter((item) => item.distanceMeters <= query.radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.title.localeCompare(b.title, "zh-Hant"))
    .slice(0, GROUP_LIMIT)
    .map(({ endTime: _endTime, ...item }) => item);
}

function pickArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function firstString(row: Record<string, unknown>, paths: string[]): string {
  for (const path of paths) {
    const value = valueAtPath(row, path);
    const text = stringifyValue(value);
    if (text) return text;
  }
  return "";
}

function firstNumber(row: Record<string, unknown>, paths: string[]): number {
  for (const path of paths) {
    const value = valueAtPath(row, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Number.NaN;
}

function firstAddress(row: Record<string, unknown>): string {
  const postalAddress = row.PostalAddress;
  if (isRecord(postalAddress)) {
    const full = firstString(row, ["PostalAddress.Address", "PostalAddress.FullAddress"]);
    if (full) return full;

    const combined = cleanText(
      [
        stringifyValue(postalAddress.City),
        stringifyValue(postalAddress.Town),
        stringifyValue(postalAddress.StreetAddress)
      ].join("")
    );

    if (combined) return combined;
  }

  return firstString(row, ["Address", "Add"]);
}

function firstPhone(row: Record<string, unknown>): string {
  const direct = firstString(row, ["Telephone", "Phone", "Tel", "Telephones.0.Tel", "Telephones.0.Phone"]);
  if (direct) return direct;

  const telephones = row.Telephones;
  if (!Array.isArray(telephones)) {
    return "";
  }

  const phones = telephones
    .map((item) => {
      if (!isRecord(item)) return stringifyValue(item);
      const tel = stringifyValue(item.Tel || item.Phone || item.Number);
      const ext = stringifyValue(item.Ext || item.Extension);
      return ext ? `${tel}#${ext}` : tel;
    })
    .filter(Boolean);

  return phones.slice(0, 2).join(" / ");
}

function valueAtPath(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      const index = Number(key);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (isRecord(current)) {
      return current[key];
    }
    return undefined;
  }, row);
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = stringifyValue(item);
      if (text) return text;
    }
  }
  if (isRecord(value)) {
    for (const key of ["URL", "Url", "url", "Name", "Text", "Value"]) {
      const text = stringifyValue(value[key]);
      if (text) return text;
    }
  }
  return "";
}

function firstImageUrl(row: Record<string, unknown>): string {
  const direct = firstString(row, [
    "Picture.PictureUrl1",
    "Picture.PictureUrl",
    "PictureUrl1",
    "ImageUrl",
    "Images.0.URL",
    "Images.0.Url",
    "Images.0.ImageUrl",
    "Pictures.0.URL",
    "Pictures.0.Url",
    "Pictures.0.PictureUrl"
  ]);
  if (direct) return direct;

  return findUrl(row.Images) || findUrl(row.Picture) || findUrl(row.Pictures) || "";
}

function findUrl(value: unknown): string {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findUrl(item);
      if (url) return url;
    }
  }
  if (isRecord(value)) {
    for (const nested of Object.values(value)) {
      const url = findUrl(nested);
      if (url) return url;
    }
  }
  return "";
}

function trimDescription(value: string): string {
  const cleaned = cleanText(value);
  return cleaned.length > 120 ? `${cleaned.slice(0, 118)}...` : cleaned;
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isPastActivity(endTime: string): boolean {
  if (!endTime) return false;
  const time = new Date(endTime).getTime();
  return Number.isFinite(time) && time < Date.now();
}

function isTaiwanCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 20 && lat <= 26.5 && lon >= 118 && lon <= 123;
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

function formatODataNumber(value: number) {
  return value.toFixed(6);
}

function bucketCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
