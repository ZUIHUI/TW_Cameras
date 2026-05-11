import cors from "@fastify/cors";
import Fastify from "fastify";
import { getCameraCatalog } from "./adapters/cameras.js";
import { getEnvironmentSummary } from "./adapters/environment.js";
import { config } from "./config.js";
import { UpstreamError } from "./http.js";
import type { SourceInfo } from "./types.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

app.get("/api/health", async () => ({
  ok: true,
  service: "taiwan-live-cam-api",
  time: new Date().toISOString()
}));

app.get("/api/cameras", async () => {
  const catalog = await getCameraCatalog();
  return {
    ...catalog.value,
    cache: {
      updatedAt: catalog.updatedAt,
      stale: catalog.stale,
      error: catalog.error
    }
  };
});

app.get<{ Params: { id: string } }>("/api/cameras/:id", async (request, reply) => {
  const catalog = await getCameraCatalog();
  const camera = catalog.value.cameras.find((item) => item.id === request.params.id);
  if (!camera) {
    return reply.code(404).send({ error: "Camera not found" });
  }
  return {
    camera,
    cache: {
      updatedAt: catalog.updatedAt,
      stale: catalog.stale,
      error: catalog.error
    }
  };
});

app.get<{ Querystring: { county?: string } }>("/api/environment", async (request, reply) => {
  const county = request.query.county?.trim();
  if (!county) {
    return reply.code(400).send({ error: "county is required" });
  }

  const summary = await getEnvironmentSummary(county);
  return {
    ...summary.value,
    cache: {
      updatedAt: summary.updatedAt,
      stale: summary.stale,
      error: summary.error
    }
  };
});

app.get("/api/sources", async (): Promise<{ sources: SourceInfo[]; updatedAt: string }> => ({
  updatedAt: new Date().toISOString(),
  sources: [
    {
      id: "tdx-cctv",
      name: "TDX 運輸資料流通服務 CCTV",
      url: "https://tdx.transportdata.tw/",
      licenseUrl: "https://data.gov.tw/license",
      cadence: "依各交通資料提供機關更新",
      notes: "本原型讀取 CCTV metadata；影像串流由來源 URL 直接播放。"
    },
    {
      id: "cwa-weather",
      name: "中央氣象署開放資料平台",
      url: "https://opendata.cwa.gov.tw/",
      licenseUrl: "https://data.gov.tw/license",
      cadence: "依資料集公告更新",
      notes: "使用縣市天氣預報做攝影機詳情的輔助資訊。"
    },
    {
      id: "moenv-aqi",
      name: "環境部空氣品質指標 AQI",
      url: "https://data.moenv.gov.tw/dataset/detail/AQX_P_432",
      licenseUrl: "https://data.gov.tw/license",
      cadence: "每小時",
      notes: "以縣市測站彙整平均與最高 AQI。"
    },
    {
      id: "wra-water",
      name: "經濟部水利署即時水位資料",
      url: "https://data.gov.tw/dataset/25768",
      licenseUrl: "https://data.gov.tw/license",
      cadence: "約 10 至 60 分鐘",
      notes: "即時原始資料可能未經完整檢核，原型會在 UI 顯示提醒。"
    }
  ]
}));

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (error instanceof UpstreamError) {
    return reply.code(error.status >= 500 ? 502 : error.status).send({
      error: "upstream_error",
      message: error.message
    });
  }

  return reply.code(500).send({
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error)
  });
});

await app.listen({ port: config.apiPort, host: "0.0.0.0" });
