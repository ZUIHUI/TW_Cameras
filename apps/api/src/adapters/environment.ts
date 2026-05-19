import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { fetchJson } from "../http.js";
import type { AqiSummary, EnvironmentSummary, SourceError, WaterLevelSummary, WeatherSummary } from "../types.js";

const ENVIRONMENT_TTL_MS = 45 * 60 * 1000;
const TAIWAN_UTC_OFFSET_HOURS = 8;
const TAIWAN_BOUNDS = {
  maxLat: 27,
  maxLon: 123,
  minLat: 20,
  minLon: 118
};
const WRA_WATER_LEVEL_URL =
  "https://data.wra.gov.tw/Service/OpenData.aspx?format=json&id=2D09DB8B-6A1B-485E-88B5-923A462F475C";
type CoordinateEnvironmentQuery = { lat: number; lon: number };
type CountyResolution = { county: string; resolvedBy: NonNullable<EnvironmentSummary["resolvedBy"]> };

const countyCentroids: Array<{ county: string; lat: number; lon: number; aliases: string[] }> = [
  { county: "基隆市", lat: 25.1276, lon: 121.7392, aliases: ["keelungcity"] },
  { county: "臺北市", lat: 25.0375, lon: 121.5637, aliases: ["台北市", "taipeicity"] },
  { county: "新北市", lat: 25.0169, lon: 121.4628, aliases: ["newtaipeicity"] },
  { county: "桃園市", lat: 24.9936, lon: 121.301, aliases: ["taoyuancity"] },
  { county: "新竹市", lat: 24.8138, lon: 120.9675, aliases: ["hsinchucity"] },
  { county: "新竹縣", lat: 24.8387, lon: 121.0177, aliases: ["hsinchucounty"] },
  { county: "苗栗縣", lat: 24.5602, lon: 120.8214, aliases: ["miaolicounty"] },
  { county: "臺中市", lat: 24.1477, lon: 120.6736, aliases: ["台中市", "taichungcity"] },
  { county: "彰化縣", lat: 24.0518, lon: 120.5161, aliases: ["changhuacounty"] },
  { county: "南投縣", lat: 23.9609, lon: 120.9719, aliases: ["nantoucounty"] },
  { county: "雲林縣", lat: 23.7092, lon: 120.4313, aliases: ["yunlincounty"] },
  { county: "嘉義市", lat: 23.4801, lon: 120.4491, aliases: ["chiayicity"] },
  { county: "嘉義縣", lat: 23.4518, lon: 120.2555, aliases: ["chiayicounty"] },
  { county: "臺南市", lat: 22.9999, lon: 120.227, aliases: ["台南市", "tainancity"] },
  { county: "高雄市", lat: 22.6273, lon: 120.3014, aliases: ["kaohsiungcity"] },
  { county: "屏東縣", lat: 22.5519, lon: 120.5487, aliases: ["pingtungcounty"] },
  { county: "宜蘭縣", lat: 24.7021, lon: 121.7378, aliases: ["yilancounty"] },
  { county: "花蓮縣", lat: 23.9872, lon: 121.6015, aliases: ["hualiencounty"] },
  { county: "臺東縣", lat: 22.7972, lon: 121.0714, aliases: ["台東縣", "taitungcounty"] },
  { county: "澎湖縣", lat: 23.5711, lon: 119.5793, aliases: ["penghucounty"] },
  { county: "金門縣", lat: 24.4368, lon: 118.3186, aliases: ["kinmencounty", "quemoycounty"] },
  { county: "連江縣", lat: 26.1602, lon: 119.9517, aliases: ["lienchiangcounty", "matsuislands"] }
];

export async function getEnvironmentSummary(county: string) {
  const normalizedCounty = county.trim();
  return timedCache.getOrSet(`environment:${normalizedCounty}`, ENVIRONMENT_TTL_MS, () =>
    loadEnvironmentSummary(normalizedCounty)
  );
}

export function parseCoordinateEnvironmentQuery(query: { lat?: string; lon?: string }) {
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false as const, message: "lat and lon must be valid numbers" };
  }

  if (!isTaiwanCoordinate(lat, lon)) {
    return { ok: false as const, message: "lat and lon must be within Taiwan bounds" };
  }

  return { ok: true as const, value: { lat, lon } };
}

export async function getEnvironmentSummaryByCoordinate(origin: CoordinateEnvironmentQuery) {
  const resolution = await resolveCountyFromCoordinate(origin);
  const summary = await getEnvironmentSummary(resolution.county);
  return {
    ...summary,
    value: {
      ...summary.value,
      origin,
      resolvedBy: resolution.resolvedBy
    }
  };
}

async function loadEnvironmentSummary(county: string): Promise<EnvironmentSummary> {
  const sourceErrors: SourceError[] = [];
  const [weather, aqi, waterLevel] = await Promise.allSettled([
    loadWeather(county),
    loadAqi(county),
    loadWaterLevel(county)
  ]);

  const summary: EnvironmentSummary = {
    county,
    sourceErrors,
    updatedAt: new Date().toISOString()
  };

  assignResult(summary, "weather", weather, sourceErrors, "中央氣象署", "F-C0032-001");
  assignResult(summary, "aqi", aqi, sourceErrors, "環境部", "AQX_P_432");
  assignResult(summary, "waterLevel", waterLevel, sourceErrors, "經濟部水利署", "25768");

  return summary;
}

async function loadWeather(county: string): Promise<WeatherSummary | undefined> {
  if (!config.cwaApiKey) {
    throw new Error("Missing CWA_API_KEY");
  }

  const url = new URL("https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001");
  url.searchParams.set("Authorization", config.cwaApiKey);
  url.searchParams.set("format", "JSON");
  url.searchParams.set("locationName", county);

  const payload = await fetchJson<unknown>(url.toString());
  const location = pickFirstLocation(payload);
  if (!location) {
    return undefined;
  }

  const elements = Array.isArray(location.weatherElement) ? location.weatherElement : [];
  const forecastTime = new Date();
  const wx = pickWeatherValue(elements, "Wx", forecastTime);
  const minT = toNumber(pickWeatherValue(elements, "MinT", forecastTime));
  const maxT = toNumber(pickWeatherValue(elements, "MaxT", forecastTime));
  const pop = toNumber(pickWeatherValue(elements, "PoP", forecastTime));
  const comfort = pickWeatherValue(elements, "CI", forecastTime);

  return {
    county,
    description: wx || "天氣資料已取得",
    minTemperature: minT,
    maxTemperature: maxT,
    rainProbability: pop,
    comfort,
    updatedAt: new Date().toISOString()
  };
}

async function loadAqi(county: string): Promise<AqiSummary | undefined> {
  if (!config.moenvApiKey) {
    throw new Error("Missing MOENV_API_KEY");
  }

  const url = new URL("https://data.moenv.gov.tw/api/v2/AQX_P_432");
  url.searchParams.set("api_key", config.moenvApiKey);
  url.searchParams.set("limit", "1000");
  url.searchParams.set("sort", "ImportDate desc");
  url.searchParams.set("format", "json");

  const payload = await fetchJson<unknown>(url.toString());
  const records = pickRecords(payload).filter((record) => sameCounty(stringField(record, "county", "County"), county));
  if (!records.length) {
    return undefined;
  }

  const readings = records
    .map((record) => ({
      aqi: toNumber(stringField(record, "aqi", "AQI")),
      status: stringField(record, "status", "Status"),
      pollutant: stringField(record, "pollutant", "Pollutant"),
      updatedAt: stringField(record, "publishtime", "PublishTime", "ImportDate")
    }))
    .filter((reading) => typeof reading.aqi === "number");

  const values = readings.map((reading) => reading.aqi).filter((value): value is number => typeof value === "number");
  const max = values.length ? Math.max(...values) : undefined;
  const worst = readings.find((reading) => reading.aqi === max);
  const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined;

  return {
    county,
    averageAqi: average,
    maxAqi: max,
    status: worst?.status,
    dominantPollutant: worst?.pollutant,
    stationCount: records.length,
    updatedAt: worst?.updatedAt
  };
}

async function loadWaterLevel(county: string): Promise<WaterLevelSummary | undefined> {
  const url = new URL(WRA_WATER_LEVEL_URL);
  if (config.wraApiKey) {
    url.searchParams.set("api_key", config.wraApiKey);
  }

  const payload = await fetchJson<unknown>(url.toString(), {}, 20000);
  const records = deepRecords(payload).filter(hasWaterLevelField);
  const countyRecords = records.filter((record) =>
    Object.values(record).some((value) => typeof value === "string" && sameCounty(value, county))
  );
  const scopedRecords = countyRecords.length ? countyRecords : records;
  const latestRecordTime = latestTime(scopedRecords);

  return {
    county,
    stationCount: scopedRecords.length,
    latestRecordTime,
    note: countyRecords.length
      ? "水位資料依來源欄位比對縣市；即時原始資料可能未經完整品管。"
      : "水利署即時水位資料已取得；此來源不一定提供可直接對應縣市的欄位，原型先顯示全台摘要。"
  };
}

function assignResult<K extends "weather" | "aqi" | "waterLevel">(
  summary: EnvironmentSummary,
  key: K,
  result: PromiseSettledResult<EnvironmentSummary[K]>,
  errors: SourceError[],
  source: string,
  endpoint: string
) {
  if (result.status === "fulfilled") {
    summary[key] = result.value;
    return;
  }

  errors.push({
    source,
    endpoint,
    message: result.reason instanceof Error ? result.reason.message : String(result.reason)
  });
}

async function resolveCountyFromCoordinate(origin: CoordinateEnvironmentQuery): Promise<CountyResolution> {
  const bucket = `${origin.lat.toFixed(3)}:${origin.lon.toFixed(3)}`;
  const resolution = await timedCache.getOrSet(`environment-county:${bucket}`, ENVIRONMENT_TTL_MS, () =>
    loadCountyResolution(origin)
  );
  return resolution.value;
}

async function loadCountyResolution(origin: CoordinateEnvironmentQuery): Promise<CountyResolution> {
  const county = await reverseGeocodeCounty(origin);
  if (county) {
    return { county, resolvedBy: "reverse-geocode" };
  }

  return { county: nearestCounty(origin), resolvedBy: "nearest-county" };
}

async function reverseGeocodeCounty(origin: CoordinateEnvironmentQuery): Promise<string | undefined> {
  if (!config.googleGeocodingApiKey) {
    return undefined;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${origin.lat},${origin.lon}`);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("key", config.googleGeocodingApiKey);

  try {
    const payload = await fetchJson<unknown>(url.toString(), {}, 8000);
    return countyFromGeocodePayload(payload);
  } catch {
    return undefined;
  }
}

function countyFromGeocodePayload(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return undefined;
  }

  for (const result of payload.results) {
    if (!isRecord(result) || !Array.isArray(result.address_components)) {
      continue;
    }

    for (const component of result.address_components) {
      if (!isRecord(component) || !Array.isArray(component.types)) {
        continue;
      }

      const types = component.types.filter((type): type is string => typeof type === "string");
      if (!types.some((type) => ["administrative_area_level_1", "administrative_area_level_2", "locality"].includes(type))) {
        continue;
      }

      const county = normalizeCountyName(stringField(component, "long_name", "short_name"));
      if (county) {
        return county;
      }
    }
  }

  return undefined;
}

function normalizeCountyName(value: string): string | undefined {
  const normalized = normalizeCountyText(value);
  if (!normalized) {
    return undefined;
  }

  for (const item of countyCentroids) {
    if ([item.county, ...item.aliases].map(normalizeCountyText).some((alias) => alias === normalized || normalized.includes(alias))) {
      return item.county;
    }
  }

  return undefined;
}

function nearestCounty(origin: CoordinateEnvironmentQuery) {
  return countyCentroids
    .map((item) => ({ item, distance: distanceKm(origin, item) }))
    .sort((a, b) => a.distance - b.distance)[0].item.county;
}

function distanceKm(a: CoordinateEnvironmentQuery, b: CoordinateEnvironmentQuery) {
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function isTaiwanCoordinate(lat: number, lon: number) {
  return lat >= TAIWAN_BOUNDS.minLat && lat <= TAIWAN_BOUNDS.maxLat && lon >= TAIWAN_BOUNDS.minLon && lon <= TAIWAN_BOUNDS.maxLon;
}

function normalizeCountyText(value: string) {
  return value.replace(/台/g, "臺").replace(/\s/g, "").trim().toLowerCase();
}

function pickFirstLocation(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  const records = payload.records;
  if (!isRecord(records)) return undefined;
  const locations = records.location;
  return Array.isArray(locations) && isRecord(locations[0]) ? locations[0] : undefined;
}

export function pickWeatherValue(elements: unknown[], name: string, targetTime = new Date()): string {
  const element = elements.find((item) => isRecord(item) && item.elementName === name);
  if (!isRecord(element) || !Array.isArray(element.time)) {
    return "";
  }
  const timeBlock = pickCurrentWeatherTimeBlock(element.time, targetTime);
  if (!timeBlock || !isRecord(timeBlock.parameter)) {
    return "";
  }
  const parameter = timeBlock.parameter;
  return stringField(parameter, "parameterName", "parameterValue");
}

function pickCurrentWeatherTimeBlock(times: unknown[], targetTime: Date): Record<string, unknown> | undefined {
  const timeBlocks = times.filter(isRecord);
  const targetMs = targetTime.getTime();
  return (
    timeBlocks.find((timeBlock) => {
      const startMs = parseTaiwanForecastTime(stringField(timeBlock, "startTime"));
      const endMs = parseTaiwanForecastTime(stringField(timeBlock, "endTime"));
      return startMs !== undefined && endMs !== undefined && targetMs >= startMs && targetMs < endMs;
    }) ?? timeBlocks[0]
  );
}

function parseTaiwanForecastTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (match) {
    const [, year, month, day, hour, minute, second = "0"] = match;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - TAIWAN_UTC_OFFSET_HOURS,
      Number(minute),
      Number(second)
    );
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["records", "Records", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function deepRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap(deepRecords);
  }
  if (!isRecord(payload)) {
    return [];
  }

  const nested = Object.values(payload).flatMap((value) => {
    if (Array.isArray(value)) {
      return value.flatMap(deepRecords);
    }
    if (isRecord(value)) {
      return deepRecords(value);
    }
    return [];
  });

  return nested.length ? nested : [payload];
}

function hasWaterLevelField(record: Record<string, unknown>): boolean {
  return ["WaterLevel", "waterlevel", "value", "Value"].some((key) => record[key] !== undefined);
}

function latestTime(records: Record<string, unknown>[]): string | undefined {
  const fields = ["RecordTime", "recordtime", "datetime", "DateTime", "DataTime"];
  const times = records
    .flatMap((record) => fields.map((field) => record[field]))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort();
  return times.at(-1);
}

function sameCounty(value: string, county: string): boolean {
  const normalize = (text: string) => text.replace("台", "臺").trim();
  return normalize(value).includes(normalize(county));
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
