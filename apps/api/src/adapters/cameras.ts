import { timedCache } from "../cache.js";
import { config } from "../config.js";
import { UpstreamError } from "../http.js";
import { tdxGet } from "../tdx.js";
import type { Camera, CameraCatalog, CameraCatalogSummary, CameraCategory, SourceError, StreamType, VehicleDetector } from "../types.js";
import { resolveTownFromCoordinate } from "./townResolver.js";

const CAMERA_TTL_MS = 20 * 60 * 1000;
const TDX_SCOPE_CONCURRENCY = 4;
const TDX_SCOPE_GAP_MS = 120;
const TDX_RETRY_DELAYS_MS = [1500];
const DEFAULT_CITY_SCOPE_CODES = ["all"];
const TOURISM_LIVE_CAMERA_URL = "https://www.taiwan.net.tw/m1.aspx?sNo=0042331";
const TOURISM_SOURCE_NAME = "交通部觀光署即時影像";
const TOURISM_GEOCODE_LIMIT = 20;

const cityScopes = [
  ["Taipei", "臺北市"],
  ["NewTaipei", "新北市"],
  ["Taoyuan", "桃園市"],
  ["Taichung", "臺中市"],
  ["Tainan", "臺南市"],
  ["Kaohsiung", "高雄市"],
  ["Keelung", "基隆市"],
  ["Hsinchu", "新竹市"],
  ["HsinchuCounty", "新竹縣"],
  ["MiaoliCounty", "苗栗縣"],
  ["ChanghuaCounty", "彰化縣"],
  ["NantouCounty", "南投縣"],
  ["YunlinCounty", "雲林縣"],
  ["Chiayi", "嘉義市"],
  ["ChiayiCounty", "嘉義縣"],
  ["PingtungCounty", "屏東縣"],
  ["YilanCounty", "宜蘭縣"],
  ["HualienCounty", "花蓮縣"],
  ["TaitungCounty", "臺東縣"],
  ["PenghuCounty", "澎湖縣"],
  ["KinmenCounty", "金門縣"],
  ["LienchiangCounty", "連江縣"]
] as const;

type CityScopeDefinition = (typeof cityScopes)[number];

interface CameraScope {
  path: string;
  category: CameraCategory;
  source: string;
  county: string;
  attribution: string;
}

const selectedCityScopes = selectCityScopes(config.tdxCityCodes);

const scopes: CameraScope[] = [
  {
    path: "/Road/Traffic/CCTV/Freeway",
    category: "freeway",
    source: "交通部高速公路局",
    county: "",
    attribution: "TDX 運輸資料流通服務 / 交通部高速公路局"
  },
  {
    path: "/Road/Traffic/CCTV/Highway",
    category: "highway",
    source: "交通部公路局",
    county: "",
    attribution: "TDX 運輸資料流通服務 / 交通部公路局"
  },
  ...selectedCityScopes.map(
    ([cityCode, countyName]): CameraScope => ({
      path: `/Road/Traffic/CCTV/City/${cityCode}`,
      category: "city",
      source: `${countyName}交通資訊中心`,
      county: countyName,
      attribution: `TDX 運輸資料流通服務 / ${countyName}`
    })
  )
];

export async function getCameraCatalog() {
  return timedCache.getOrSet("tdx-cameras", CAMERA_TTL_MS, loadCameraCatalog);
}

async function loadCameraCatalog(): Promise<CameraCatalog> {
  const [cameraResult, scenicResult] = await Promise.allSettled([
    loadCameraCatalogData(),
    loadTourismScenicCatalog()
  ]);

  const trafficCameras = cameraResult.status === "fulfilled" ? cameraResult.value.cameras : [];
  const cameraErrors = cameraResult.status === "fulfilled" ? cameraResult.value.sourceErrors : [
    {
      source: "TDX 運輸資料流通服務",
      endpoint: "Road Traffic CCTV",
      message: cameraResult.reason instanceof Error ? cameraResult.reason.message : String(cameraResult.reason)
    }
  ];
  const scenicCameras = scenicResult.status === "fulfilled" ? scenicResult.value.cameras : [];
  const scenicErrors = scenicResult.status === "fulfilled" ? scenicResult.value.sourceErrors : [
    {
      source: TOURISM_SOURCE_NAME,
      endpoint: TOURISM_LIVE_CAMERA_URL,
      message: scenicResult.reason instanceof Error ? scenicResult.reason.message : String(scenicResult.reason)
    }
  ];

  const vehicleDetectors: VehicleDetector[] = [];
  const cameras = [...trafficCameras, ...scenicCameras];
  const sourceErrors = [...cameraErrors, ...scenicErrors];

  return {
    cameras,
    vehicleDetectors,
    sourceErrors,
    summary: buildSummary(cameras, vehicleDetectors, sourceErrors),
    updatedAt: new Date().toISOString()
  };
}

function buildSummary(cameras: Camera[], vehicleDetectors: VehicleDetector[], sourceErrors: SourceError[]): CameraCatalogSummary {
  const byCategory: Record<CameraCategory, number> = {
    freeway: 0,
    highway: 0,
    city: 0,
    scenic: 0
  };
  const byStreamType: Record<StreamType, number> = {
    hls: 0,
    mjpeg: 0,
    snapshot: 0,
    webpage: 0,
    unknown: 0
  };
  const byCounty: Record<string, number> = {};

  for (const camera of cameras) {
    byCategory[camera.category] += 1;
    byStreamType[camera.streamType] += 1;

    const county = camera.county || "未標示縣市";
    byCounty[county] = (byCounty[county] || 0) + 1;
  }

  const hasAnyTrafficData = cameras.length > 0 || vehicleDetectors.length > 0;
  const status = !hasAnyTrafficData && sourceErrors.length > 0 ? "unavailable" : sourceErrors.length > 0 ? "partial" : "ok";

  return {
    cameras: {
      total: cameras.length,
      byCategory,
      byStreamType,
      byCounty
    },
    vehicleDetectors: {
      total: vehicleDetectors.length
    },
    sourceHealth: {
      status,
      errorCount: sourceErrors.length
    }
  };
}

async function loadCameraCatalogData(): Promise<{ cameras: Camera[]; sourceErrors: SourceError[] }> {
  const settled = await allSettledWithConcurrency(scopes, TDX_SCOPE_CONCURRENCY, loadScope);
  const cameras: Camera[] = [];
  const sourceErrors: SourceError[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      cameras.push(...(result.value as Camera[]));
    } else {
      sourceErrors.push({
        source: scopes[index].source,
        endpoint: scopes[index].path,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    }
  });

  const deduped = dedupeCameras(cameras).sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
  if (!deduped.length && !sourceErrors.length) {
    sourceErrors.push({
      source: "TDX",
      endpoint: "Road Traffic CCTV",
      message: "No CCTV records could be loaded from TDX."
    });
  }

  return {
    cameras: deduped,
    sourceErrors
  };
}

interface ScenicListItem {
  uid: string;
  title: string;
  county: string;
  source: string;
  pageUrl: string;
  status: "online" | "offline" | "unknown";
}

async function loadTourismScenicCatalog(): Promise<{ cameras: Camera[]; sourceErrors: SourceError[] }> {
  try {
    const html = await fetchText(TOURISM_LIVE_CAMERA_URL, {}, 6000);
    const items = parseTourismItems(html);
    const sourceErrors: SourceError[] = [];
    let geocodedCount = 0;

    const settled = await allSettledWithConcurrency(items, 3, async (item) => {
      const coordinate = findScenicCoordinate(item.title, item.county);
      const resolvedCoordinate =
        coordinate || (geocodedCount++ < TOURISM_GEOCODE_LIMIT ? await geocodeScenicItem(item) : undefined);

      if (!resolvedCoordinate) {
        return undefined;
      }

      return normalizeScenicCamera(item, resolvedCoordinate);
    });

    const cameras = settled
      .filter((result): result is PromiseFulfilledResult<Camera | undefined> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((camera): camera is Camera => Boolean(camera));
    const failedCount = settled.filter((result) => result.status === "rejected").length;
    const skippedCount = items.length - cameras.length - failedCount;

    if (failedCount || skippedCount) {
      sourceErrors.push({
        source: TOURISM_SOURCE_NAME,
        endpoint: TOURISM_LIVE_CAMERA_URL,
        message: `${failedCount} scenic cameras failed and ${skippedCount} scenic cameras were skipped because coordinates were unavailable.`
      });
    }

    return {
      cameras,
      sourceErrors
    };
  } catch (error) {
    const cameras = buildCuratedScenicCameras();
    return {
      cameras,
      sourceErrors: [
        {
          source: TOURISM_SOURCE_NAME,
          endpoint: TOURISM_LIVE_CAMERA_URL,
          message: `${error instanceof Error ? error.message : String(error)}; using curated scenic camera locations.`
        }
      ]
    };
  }
}

async function loadScope(scope: CameraScope): Promise<Camera[]> {
  const payload = await withTdxRetry(() => tdxGet<unknown>(scope.path, {}, { auth: "auto" }));
  const rows = pickArray(payload);
  return rows.map((row) => normalizeCamera(row, scope)).filter((camera): camera is Camera => Boolean(camera));
}

function selectCityScopes(rawValue: string): CityScopeDefinition[] {
  const value = rawValue.trim();
  if (!value || value.toLowerCase() === "all") {
    return [...cityScopes];
  }

  const requestedCodes = (value || DEFAULT_CITY_SCOPE_CODES.join(","))
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
  const requestedSet = new Set(requestedCodes);
  const selected = cityScopes.filter(([cityCode]) => requestedSet.has(cityCode.toLowerCase()));

  if (selected.length) {
    return selected;
  }

  const fallbackSet = new Set(DEFAULT_CITY_SCOPE_CODES.map((code) => code.toLowerCase()));
  return fallbackSet.has("all") ? [...cityScopes] : cityScopes.filter(([cityCode]) => fallbackSet.has(cityCode.toLowerCase()));
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 TaiwanLiveCameraPrototype/0.1",
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new UpstreamError(`Upstream responded ${response.status}: ${body.slice(0, 240)}`, response.status);
    }

    return response.text();
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError(`Upstream request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseTourismItems(html: string): ScenicListItem[] {
  const items: ScenicListItem[] = [];
  const blocks = html.match(/<li>\s*<div class="media-item">[\s\S]*?<\/li>/g) || [];

  for (const block of blocks) {
    const href = firstRegex(block, /<a\s+href="([^"]*uid=(\d+)[^"]*)"/);
    const uid = firstRegex(block, /uid=(\d+)/);
    const title = decodeHtml(firstRegex(block, /class="media-title">([\s\S]*?)<\/div>/));
    const county = decodeHtml(firstRegex(block, /<small>([\s\S]*?)<\/small>/));
    const source = decodeHtml(firstRegex(block, /即時影像提供來源：([\s\S]*?)(?:\r|\n|<a|<\/div>)/)) || TOURISM_SOURCE_NAME;

    if (!href || !uid || !title || !county) {
      continue;
    }

    items.push({
      uid,
      title,
      county,
      source,
      pageUrl: new URL(href.replaceAll("&amp;", "&"), TOURISM_LIVE_CAMERA_URL).toString(),
      status: block.includes("is-online") ? "online" : block.includes("is-offline") ? "offline" : "unknown"
    });
  }

  return dedupeScenicItems(items);
}

function normalizeScenicCamera(item: ScenicListItem, coordinate: { lat: number; lon: number }): Camera | undefined {
  if (!isTaiwanCoordinate(coordinate.lat, coordinate.lon)) {
    return undefined;
  }

  return {
    id: `scenic:${item.uid}`,
    source: item.source || TOURISM_SOURCE_NAME,
    sourceCameraId: item.uid,
    title: item.title,
    category: "scenic",
    county: item.county,
    town: "",
    roadName: "風景區",
    lat: coordinate.lat,
    lon: coordinate.lon,
    streamUrl: item.pageUrl,
    streamType: "webpage",
    sourcePageUrl: item.pageUrl,
    attribution: TOURISM_SOURCE_NAME,
    status: item.status,
    updatedAt: new Date().toISOString()
  };
}

async function geocodeScenicItem(item: ScenicListItem): Promise<{ lat: number; lon: number } | undefined> {
  if (!config.googleGeocodingApiKey) {
    return undefined;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${item.title} ${item.county} 台灣`);
  url.searchParams.set("region", "tw");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("key", config.googleGeocodingApiKey);

  const payload = await fetchJsonLike(url.toString());
  const first = payload.results?.[0];
  const location = first?.geometry?.location;
  if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
    return undefined;
  }

  return { lat: location.lat, lon: location.lng };
}

async function fetchJsonLike(url: string): Promise<{ results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> }> {
  const text = await fetchText(url, {}, 12000);
  return JSON.parse(text) as { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> };
}

const scenicCoordinates: Array<{ keywords: string[]; lat: number; lon: number }> = [
  { keywords: ["大佳河濱公園"], lat: 25.0738, lon: 121.5386 },
  { keywords: ["碧山巖"], lat: 25.0984, lon: 121.5859 },
  { keywords: ["劍潭山"], lat: 25.0836, lon: 121.5271 },
  { keywords: ["淡水漁人碼頭"], lat: 25.1837, lon: 121.4105 },
  { keywords: ["八里左岸"], lat: 25.1589, lon: 121.4352 },
  { keywords: ["野柳"], lat: 25.207, lon: 121.6909 },
  { keywords: ["十分瀑布"], lat: 25.0495, lon: 121.7871 },
  { keywords: ["龜山島"], lat: 24.8419, lon: 121.9517 },
  { keywords: ["太平山"], lat: 24.4968, lon: 121.5253 },
  { keywords: ["武陵農場"], lat: 24.3837, lon: 121.3097 },
  { keywords: ["高美濕地"], lat: 24.3104, lon: 120.5497 },
  { keywords: ["梨山"], lat: 24.2548, lon: 121.2524 },
  { keywords: ["合歡山"], lat: 24.142, lon: 121.2727 },
  { keywords: ["清境"], lat: 24.0443, lon: 121.1566 },
  { keywords: ["日月潭"], lat: 23.8659, lon: 120.9155 },
  { keywords: ["阿里山"], lat: 23.5087, lon: 120.805 },
  { keywords: ["東石漁人碼頭"], lat: 23.4526, lon: 120.136 },
  { keywords: ["七股鹽山"], lat: 23.154, lon: 120.1011 },
  { keywords: ["北門"], lat: 23.2677, lon: 120.1245 },
  { keywords: ["曾文水庫"], lat: 23.2435, lon: 120.5411 },
  { keywords: ["墾丁"], lat: 21.9461, lon: 120.7997 },
  { keywords: ["鵝鑾鼻"], lat: 21.9029, lon: 120.8521 },
  { keywords: ["小琉球", "琉球"], lat: 22.3381, lon: 120.3692 },
  { keywords: ["清水斷崖"], lat: 24.2183, lon: 121.6899 },
  { keywords: ["太魯閣"], lat: 24.1587, lon: 121.621 },
  { keywords: ["石梯坪"], lat: 23.4823, lon: 121.5103 },
  { keywords: ["三仙台"], lat: 23.1255, lon: 121.4173 },
  { keywords: ["蘭嶼"], lat: 22.0379, lon: 121.5508 },
  { keywords: ["雙心石滬"], lat: 23.2196, lon: 119.5196 },
  { keywords: ["金門", "莒光樓"], lat: 24.4327, lon: 118.3171 },
  { keywords: ["北竿", "芹壁"], lat: 26.2242, lon: 119.9967 }
];

function buildCuratedScenicCameras(): Camera[] {
  return scenicCoordinates.map((entry, index) => {
    const title = entry.keywords[0];
    return {
      id: `scenic:curated:${index}`,
      source: TOURISM_SOURCE_NAME,
      sourceCameraId: `curated:${index}`,
      title,
      category: "scenic",
      county: "台灣",
      town: "",
      roadName: "風景區",
      lat: entry.lat,
      lon: entry.lon,
      streamUrl: TOURISM_LIVE_CAMERA_URL,
      streamType: "webpage",
      sourcePageUrl: TOURISM_LIVE_CAMERA_URL,
      attribution: TOURISM_SOURCE_NAME,
      status: "unknown",
      updatedAt: new Date().toISOString()
    };
  });
}

function findScenicCoordinate(title: string, county: string): { lat: number; lon: number } | undefined {
  const text = `${title} ${county}`;
  const match = scenicCoordinates.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)));
  return match ? { lat: match.lat, lon: match.lon } : undefined;
}

function dedupeScenicItems(items: ScenicListItem[]): ScenicListItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.uid || `${item.county}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstRegex(value: string, regex: RegExp): string {
  return value.match(regex)?.[1]?.trim() || "";
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function allSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;

      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }

      await sleep(TDX_SCOPE_GAP_MS);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function withTdxRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= TDX_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await task();
    } catch (error) {
      const shouldRetry = isRetryableTdxError(error) && attempt < TDX_RETRY_DELAYS_MS.length;
      if (!shouldRetry) {
        throw error;
      }

      await sleep(TDX_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error("TDX retry loop exited unexpectedly.");
}

function isRetryableTdxError(error: unknown): boolean {
  return error instanceof UpstreamError && (error.status === 429 || error.status >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeCamera(row: unknown, scope: CameraScope): Camera | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const sourceCameraId = firstString(row, ["CCTVID", "CCTVId", "CCTVID", "ID", "id"]);
  const streamUrl = firstString(row, ["VideoStreamURL", "VideoStreamingURL", "VideoURL", "ImageURL", "URL", "Url"]);
  const lat = firstNumber(row, ["PositionLat", "Latitude", "Lat", "lat"], ["Position", "Geometry"]);
  const lon = firstNumber(row, ["PositionLon", "Longitude", "Lon", "lng", "lon"], ["Position", "Geometry"]);

  if (lat === undefined || lon === undefined || !sourceCameraId || !streamUrl || !isTaiwanCoordinate(lat, lon)) {
    return undefined;
  }

  const roadName = firstString(row, ["RoadName", "Road", "RouteName"]) || "";
  const location = firstString(row, ["LocationDescription", "Location", "LocationMile", "MilePost"]) || "";
  const direction = firstString(row, ["RoadDirection", "Direction", "Bearing"]) || "";
  const county = firstString(row, ["CountyName", "CityName", "County", "City"]) || scope.county;
  const town = firstString(row, ["TownName", "Town", "District"]) || resolveTownFromCoordinate(county, lat, lon);
  const updatedAt = firstString(row, ["UpdateTime", "UpdatedTime", "DataCollectTime", "SrcUpdateTime"]) || new Date().toISOString();

  return {
    id: `${scope.category}:${sourceCameraId}`,
    source: scope.source,
    sourceCameraId,
    title: buildTitle(roadName, location, direction, sourceCameraId),
    category: scope.category,
    county,
    town,
    roadName,
    lat,
    lon,
    streamUrl,
    streamType: detectStreamType(streamUrl),
    sourcePageUrl: streamUrl,
    attribution: scope.attribution,
    status: "unknown",
    updatedAt
  };
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["CCTVs", "CCTV", "data", "records", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  const firstArray = Object.values(payload).find(Array.isArray);
  return Array.isArray(firstArray) ? firstArray : [];
}

function dedupeCameras(cameras: Camera[]): Camera[] {
  const seen = new Set<string>();
  const deduped: Camera[] = [];

  for (const camera of cameras) {
    const key = camera.id || `${camera.lat.toFixed(5)}:${camera.lon.toFixed(5)}:${camera.streamUrl}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(camera);
    }
  }

  return deduped;
}

function buildTitle(roadName: string, location: string, direction: string, fallback: string): string {
  const parts = [roadName, location, direction].filter(Boolean);
  return parts.length ? parts.join(" ") : fallback;
}

function detectStreamType(url: string): StreamType {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes("mjpeg") || lower.includes("mjpg")) return "mjpeg";
  if (lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".png")) return "snapshot";
  if (isWebpageStreamUrl(lower)) return "webpage";
  return "unknown";
}

function isWebpageStreamUrl(lowerUrl: string): boolean {
  if (lowerUrl.includes("hls.bote.gov.taipei/live/index.html")) {
    return true;
  }

  return [".html", ".htm"].some((extension) => {
    const extensionIndex = lowerUrl.indexOf(extension);
    if (extensionIndex === -1) return false;

    const nextChar = lowerUrl[extensionIndex + extension.length];
    return !nextChar || nextChar === "?" || nextChar === "#" || nextChar === "/";
  });
}

function isTaiwanCoordinate(lat: number, lon: number): boolean {
  return lat >= 20 && lat <= 27 && lon >= 118 && lon <= 123;
}

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function firstNumber(row: Record<string, unknown>, keys: string[], objectKeys: string[] = []): number | undefined {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== undefined) {
      return value;
    }
  }

  for (const objectKey of objectKeys) {
    const nested = row[objectKey];
    if (!isRecord(nested)) continue;

    for (const key of keys) {
      const value = toNumber(nested[key]);
      if (value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
