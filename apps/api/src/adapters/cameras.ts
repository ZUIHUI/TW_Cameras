import { timedCache } from "../cache.js";
import { missingEnv } from "../config.js";
import { tdxGet } from "../tdx.js";
import type { Camera, CameraCatalog, CameraCategory, SourceError, StreamType } from "../types.js";

const CAMERA_TTL_MS = 20 * 60 * 1000;

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
    return {
      cameras: [],
      sourceErrors: [
        {
          source: "TDX 運輸資料流通服務",
          endpoint: "TDX OAuth / Road Traffic CCTV",
          message: "TDX_CLIENT_ID and TDX_CLIENT_SECRET are not set yet."
        }
      ],
      updatedAt: new Date().toISOString()
    };
  }

  const settled = await Promise.allSettled(scopes.map(loadScope));
  const cameras: Camera[] = [];
  const sourceErrors: SourceError[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      cameras.push(...result.value);
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
    sourceErrors,
    updatedAt: new Date().toISOString()
  };
}

async function loadScope(scope: CameraScope): Promise<Camera[]> {
  const payload = await tdxGet<unknown>(scope.path);
  const rows = pickArray(payload);
  return rows.map((row) => normalizeCamera(row, scope)).filter((camera): camera is Camera => Boolean(camera));
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
  const town = firstString(row, ["TownName", "Town", "District"]) || "";
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
  return "unknown";
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
