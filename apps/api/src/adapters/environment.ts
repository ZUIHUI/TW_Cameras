import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { fetchJson } from "../http.js";
import type { AqiSummary, EnvironmentSummary, SourceError, WaterLevelSummary, WeatherSummary } from "../types.js";

const ENVIRONMENT_TTL_MS = 45 * 60 * 1000;
const WRA_WATER_LEVEL_URL =
  "https://data.wra.gov.tw/Service/OpenData.aspx?format=json&id=2D09DB8B-6A1B-485E-88B5-923A462F475C";

export async function getEnvironmentSummary(county: string) {
  const normalizedCounty = county.trim();
  return timedCache.getOrSet(`environment:${normalizedCounty}`, ENVIRONMENT_TTL_MS, () =>
    loadEnvironmentSummary(normalizedCounty)
  );
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
  const wx = pickWeatherValue(elements, "Wx");
  const minT = toNumber(pickWeatherValue(elements, "MinT"));
  const maxT = toNumber(pickWeatherValue(elements, "MaxT"));
  const pop = toNumber(pickWeatherValue(elements, "PoP"));
  const comfort = pickWeatherValue(elements, "CI");

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

function pickFirstLocation(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  const records = payload.records;
  if (!isRecord(records)) return undefined;
  const locations = records.location;
  return Array.isArray(locations) && isRecord(locations[0]) ? locations[0] : undefined;
}

function pickWeatherValue(elements: unknown[], name: string): string {
  const element = elements.find((item) => isRecord(item) && item.elementName === name);
  if (!isRecord(element) || !Array.isArray(element.time)) {
    return "";
  }
  const firstTime = element.time.find(isRecord);
  if (!firstTime || !isRecord(firstTime.parameter)) {
    return "";
  }
  const parameter = firstTime.parameter;
  return stringField(parameter, "parameterName", "parameterValue");
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
