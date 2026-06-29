import cors from "@fastify/cors";
import Fastify from "fastify";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fetchCameraStreamResponse } from "./adapters/cameraStream.js";
import { getCameraCatalog } from "./adapters/cameras.js";
import {
  getEnvironmentSummary,
  getEnvironmentSummaryByCoordinate,
  parseCoordinateEnvironmentQuery
} from "./adapters/environment.js";
import {
  getGoogleNearbyRestaurants,
  getGooglePlaceDetails,
  getGooglePlacePredictions,
  parseNearbyRestaurantsQuery,
  parsePlaceAutocompleteQuery,
  parsePlaceDetailsQuery
} from "./adapters/googlePlaces.js";
import { getNearbyTourismSummary, parseNearbyTourismQuery } from "./adapters/nearbyTourism.js";
import { getRadarOverlay } from "./adapters/radar.js";
import { getNearbyRainfallSummary, parseRainfallQuery } from "./adapters/rainfall.js";
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

app.get<{ Params: { id: string } }>("/api/cameras/:id/stream", async (request, reply) => {
  const catalog = await getCameraCatalog();
  const camera = catalog.value.cameras.find((item) => item.id === request.params.id);
  if (!camera) {
    return reply.code(404).send({ error: "Camera not found" });
  }

  const response = await fetchCameraStreamResponse(camera, request.url, {
    accept: asHeaderString(request.headers.accept),
    range: asHeaderString(request.headers.range),
    userAgent: asHeaderString(request.headers["user-agent"])
  });

  reply.code(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));

  if (!response.body) {
    return reply.send();
  }

  return reply.send(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>));
});

app.get<{ Querystring: { county?: string; lat?: string; lon?: string } }>("/api/environment", async (request, reply) => {
  if (request.query.lat !== undefined || request.query.lon !== undefined) {
    const query = parseCoordinateEnvironmentQuery(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: "invalid_query", message: query.message });
    }

    const summary = await getEnvironmentSummaryByCoordinate(query.value);
    return {
      ...summary.value,
      cache: {
        updatedAt: summary.updatedAt,
        stale: summary.stale,
        error: summary.error
      }
    };
  }

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

app.get<{ Querystring: { lat?: string; lon?: string } }>("/api/environment/coordinate", async (request, reply) => {
  const query = parseCoordinateEnvironmentQuery(request.query);
  if (!query.ok) {
    return reply.code(400).send({ error: "invalid_query", message: query.message });
  }

  const summary = await getEnvironmentSummaryByCoordinate(query.value);
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

app.get<{ Querystring: { lat?: string; lon?: string; radius?: string; limit?: string } }>("/api/rainfall", async (request, reply) => {
  const query = parseRainfallQuery(request.query);
  if (!query.ok) {
    return reply.code(400).send({ error: "invalid_query", message: query.message });
  }

  const rainfall = await getNearbyRainfallSummary(query.value);
  return {
    ...rainfall.value,
    cache: {
      updatedAt: rainfall.updatedAt,
      stale: rainfall.stale,
      error: rainfall.error
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

app.get<{
  Querystring: { kind?: string; input?: string; placeId?: string; lat?: string; lon?: string; radius?: string };
}>("/api/google-places", async (request, reply) => {
  if (request.query.kind === "nearby-restaurants") {
    const query = parseNearbyRestaurantsQuery(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: "invalid_query", message: query.message });
    }
    return getGoogleNearbyRestaurants(query.value);
  }

  if (request.query.kind === "autocomplete") {
    const query = parsePlaceAutocompleteQuery(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: "invalid_query", message: query.message });
    }
    return getGooglePlacePredictions(query.value.input);
  }

  if (request.query.kind === "details") {
    const query = parsePlaceDetailsQuery(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: "invalid_query", message: query.message });
    }
    return getGooglePlaceDetails(query.value.placeId);
  }

  return reply.code(400).send({ error: "invalid_query", message: "kind is required." });
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

function asHeaderString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}
