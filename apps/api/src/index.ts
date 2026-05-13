import cors from "@fastify/cors";
import Fastify from "fastify";
import { getCameraCatalog } from "./adapters/cameras.js";
import { getEnvironmentSummary } from "./adapters/environment.js";
import { getNearbyTourismSummary, parseNearbyTourismQuery } from "./adapters/nearbyTourism.js";
import { getRadarOverlay } from "./adapters/radar.js";
import { config } from "./config.js";
import { UpstreamError } from "./http.js";
import { sources } from "./sources.js";

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

app.get("/api/radar", async () => {
  const radar = await getRadarOverlay();
  return {
    ...radar.value,
    cache: {
      updatedAt: radar.updatedAt,
      stale: radar.stale,
      error: radar.error
    }
  };
});

app.get<{ Querystring: { lat?: string; lon?: string; radius?: string } }>("/api/nearby-tourism", async (request, reply) => {
  const query = parseNearbyTourismQuery(request.query);
  if (!query.ok) {
    return reply.code(400).send({ error: "invalid_query", message: query.message });
  }

  const summary = await getNearbyTourismSummary(query.value);
  return {
    ...summary.value,
    cache: {
      updatedAt: summary.updatedAt,
      stale: summary.stale,
      error: summary.error
    }
  };
});

app.get("/api/sources", async () => ({
  updatedAt: new Date().toISOString(),
  sources
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
