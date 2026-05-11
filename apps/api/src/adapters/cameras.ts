import { timedCache } from "../cache.js";
import { missingEnv } from "../config.js";
import { UpstreamError } from "../http.js";
import { tdxGet } from "../tdx.js";
import type { Camera, CameraCatalog, CameraCatalogSummary, CameraCategory, SourceError, StreamType, VehicleDetector } from "../types.js";
import { resolveTownFromCoordinate } from "./townResolver.js";

const CAMERA_TTL_MS = 20 * 60 * 1000;
const TDX_SCOPE_CONCURRENCY = 2;
const TDX_SCOPE_GAP_MS = 400;
const TDX_RETRY_DELAYS_MS = [1500];

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

interface CameraScope {
  path: string;
  category: CameraCategory;
  source: string;
  county: string;
  attribution: string;
}

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
  ...cityScopes.map(
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
  if (missingEnv(["tdxClientId", "tdxClientSecret"]).length) {
    const sourceErrors = [
      {
        source: "TDX 運輸資料流通服務",
        endpoint: "TDX OAuth / Road Traffic CCTV & VD",
        message: "TDX_CLIENT_ID and TDX_CLIENT_SECRET are not set yet."
      }
    ];

    return {
      cameras: [],
      vehicleDetectors: [],
      sourceErrors,
      summary: buildSummary([], [], sourceErrors),
      updatedAt: new Date().toISOString()
    };
  }

  const [cameraResult, vdResult] = await Promise.allSettled([
    loadCameraCatalogData(),
    loadVehicleDetectorCatalog()
  ]);

  const cameras = cameraResult.status === "fulfilled" ? cameraResult.value.cameras : [];
  const cameraErrors = cameraResult.status === "fulfilled" ? cameraResult.value.sourceErrors : [
    {
      source: "TDX 運輸資料流通服務",
      endpoint: "Road Traffic CCTV",
      message: cameraResult.reason instanceof Error ? cameraResult.reason.message : String(cameraResult.reason)
    }
  ];

  const vehicleDetectors = vdResult.status === "fulfilled" ? vdResult.value.vehicleDetectors : [];
  const vdErrors = vdResult.status === "fulfilled" ? vdResult.value.sourceErrors : [
    {
      source: "TDX 運輸資料流通服務",
      endpoint: "Road Traffic VD",
      message: vdResult.reason instanceof Error ? vdResult.reason.message : String(vdResult.reason)
    }
  ];

  const sourceErrors = [...cameraErrors, ...vdErrors];

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
    city: 0
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
  if (!deduped.length) {
    throw new Error("No CCTV records could be loaded from TDX.");
  }

  return {
    cameras: deduped,
    sourceErrors
  };
}

async function loadVehicleDetectorCatalog(): Promise<{ vehicleDetectors: VehicleDetector[]; sourceErrors: SourceError[] }> {
  try {
    const payload = await withTdxRetry(() => tdxGet<unknown>("/Road/Traffic/VD/Freeway"));
    const vdData = payload as { VDs: unknown[] };
    const rows = vdData.VDs || [];
    
    const vehicleDetectors = rows
      .map((row) => normalizeVehicleDetector(row))
      .filter((vd): vd is VehicleDetector => Boolean(vd))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));

    return {
      vehicleDetectors,
      sourceErrors: []
    };
  } catch (error) {
    return {
      vehicleDetectors: [],
      sourceErrors: [
        {
          source: "TDX 運輸資料流通服務",
          endpoint: "/Road/Traffic/VD/Freeway",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
}

async function loadScope(scope: CameraScope): Promise<Camera[]> {
  const payload = await withTdxRetry(() => tdxGet<unknown>(scope.path));
  const rows = pickArray(payload);
  return rows.map((row) => normalizeCamera(row, scope)).filter((camera): camera is Camera => Boolean(camera));
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

function normalizeVehicleDetector(row: unknown): VehicleDetector | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const vdId = firstString(row, ["VDID", "VDId", "ID", "id"]);
  const lat = firstNumber(row, ["PositionLat", "Latitude", "Lat", "lat"]);
  const lon = firstNumber(row, ["PositionLon", "Longitude", "Lon", "lng", "lon"]);

  if (!vdId || lat === undefined || lon === undefined || !isTaiwanCoordinate(lat, lon)) {
    return undefined;
  }

  const roadName = firstString(row, ["RoadName", "Road", "RouteName"]) || "";
  const roadSection = row.RoadSection;
  const biDirectional = typeof row.BiDirectional === "number" ? row.BiDirectional : 0;
  const detectionLinks = Array.isArray(row.DetectionLinks) ? row.DetectionLinks : [];
  const updatedAt = firstString(row, ["UpdateTime", "UpdatedTime", "DataCollectTime", "SrcUpdateTime"]) || new Date().toISOString();

  const normalizedDetectionLinks = detectionLinks
    .filter((link): link is Record<string, unknown> => isRecord(link))
    .map((link) => ({
      linkId: firstString(link, ["LinkID", "LinkId", "ID", "id"]) || "",
      bearing: firstString(link, ["Bearing", "Direction"]) || "",
      roadDirection: firstString(link, ["RoadDirection", "Direction"]) || "",
      laneNum: typeof link.LaneNum === "number" ? link.LaneNum : 0,
      actualLaneNum: typeof link.ActualLaneNum === "number" ? link.ActualLaneNum : 0
    }));

  const roadSectionNormalized = isRecord(roadSection) ? {
    start: firstString(roadSection, ["Start"]) || "",
    end: firstString(roadSection, ["End"]) || ""
  } : { start: "", end: "" };

  return {
    id: `vd:${vdId}`,
    source: "TDX 運輸資料流通服務",
    vdId,
    title: `${roadName} ${roadSectionNormalized.start} - ${roadSectionNormalized.end}`.trim() || vdId,
    roadName,
    roadSection: roadSectionNormalized,
    lat,
    lon,
    biDirectional,
    detectionLinks: normalizedDetectionLinks,
    attribution: "TDX 運輸資料流通服務 / 交通部高速公路局",
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
