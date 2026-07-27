import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleRoutesRequest,
  computeRoutes,
  normalizeGoogleRoutes,
  parseRouteRequest
} from "../src/adapters/routes.js";
import { UpstreamError } from "../src/http.js";

const baseRequest = {
  origin: { lat: 25.0478, lon: 121.517 },
  destination: { lat: 25.033, lon: 121.5654 },
  mode: "two-wheeler",
  alternatives: true
} as const;

test("parseRouteRequest accepts Taiwan coordinates and rejects unsupported input", () => {
  const parsed = parseRouteRequest({
    ...baseRequest,
    avoid: { tolls: true, highways: true, ferries: false }
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value.avoid : undefined, {
    tolls: true,
    highways: true,
    ferries: false
  });

  assert.equal(parseRouteRequest({ ...baseRequest, mode: "drive" }).ok, false);
  assert.equal(parseRouteRequest({ ...baseRequest, destination: { lat: 35, lon: 139 } }).ok, false);
  assert.equal(parseRouteRequest({ ...baseRequest, alternatives: false }).ok, false);
});

test("buildGoogleRoutesRequest keeps mode-specific options separate", () => {
  assert.deepEqual(buildGoogleRoutesRequest({ ...baseRequest, avoid: { highways: true } }).routeModifiers, {
    avoidTolls: false,
    avoidHighways: true,
    avoidFerries: false
  });

  const transit = buildGoogleRoutesRequest({
    ...baseRequest,
    mode: "transit",
    transit: {
      timeMode: "arrive-by",
      dateTime: "2026-07-28T09:00:00+08:00",
      preference: "fewer-transfers",
      modes: ["bus", "subway"]
    }
  });
  assert.equal(transit.travelMode, "TRANSIT");
  assert.equal(transit.arrivalTime, "2026-07-28T09:00:00+08:00");
  assert.deepEqual(transit.transitPreferences, {
    routingPreference: "FEWER_TRANSFERS",
    allowedTravelModes: ["BUS", "SUBWAY"]
  });
});

test("normalizeGoogleRoutes returns no more than three routes and transit details", () => {
  const route = {
    routeLabels: ["DEFAULT_ROUTE"],
    distanceMeters: 7200,
    duration: "1250s",
    viewport: {
      low: { latitude: 25.03, longitude: 121.51 },
      high: { latitude: 25.06, longitude: 121.57 }
    },
    polyline: { encodedPolyline: "abc" },
    legs: [
      {
        distanceMeters: 7200,
        duration: "1250s",
        startLocation: { latLng: { latitude: 25.0478, longitude: 121.517 } },
        endLocation: { latLng: { latitude: 25.033, longitude: 121.5654 } },
        steps: [
          {
            distanceMeters: 1000,
            staticDuration: "300s",
            polyline: { encodedPolyline: "step" },
            startLocation: { latLng: { latitude: 25.0478, longitude: 121.517 } },
            endLocation: { latLng: { latitude: 25.04, longitude: 121.53 } },
            navigationInstruction: { maneuver: "TURN_RIGHT", instructions: "右轉忠孝東路" },
            travelMode: "TRANSIT",
            transitDetails: {
              stopDetails: {
                departureStop: {
                  name: "台北車站",
                  location: { latLng: { latitude: 25.0478, longitude: 121.517 } }
                },
                arrivalStop: {
                  name: "市政府",
                  location: { latLng: { latitude: 25.04, longitude: 121.56 } }
                },
                departureTime: "2026-07-28T08:00:00+08:00",
                arrivalTime: "2026-07-28T08:12:00+08:00"
              },
              headsign: "南港",
              stopCount: 5,
              transitLine: {
                name: "板南線",
                nameShort: "BL",
                vehicle: { name: { text: "捷運" }, type: "SUBWAY" }
              }
            }
          }
        ]
      }
    ]
  };

  const normalized = normalizeGoogleRoutes({ routes: [route, route, route, route] }, "transit");
  assert.equal(normalized.routes.length, 3);
  assert.equal(normalized.routes[0].durationSeconds, 1250);
  assert.equal(normalized.routes[0].legs[0].steps[0].transit?.departureStop?.name, "台北車站");
  assert.equal(normalized.routes[0].legs[0].steps[0].transit?.line?.shortName, "BL");
  assert.deepEqual(normalized.routes[0].warnings, []);

  const walking = normalizeGoogleRoutes({ routes: [route] }, "walk");
  assert.match(walking.routes[0].warnings[0], /Beta/);
});

test("computeRoutes keeps the key in headers and maps Google errors", async () => {
  let observedKey = "";
  await computeRoutes(
    baseRequest,
    async (_input, init) => {
      observedKey = new Headers(init?.headers).get("X-Goog-Api-Key") || "";
      return Response.json({
        routes: [
          {
            distanceMeters: 1,
            duration: "1s",
            viewport: {
              low: { latitude: 25, longitude: 121 },
              high: { latitude: 25.1, longitude: 121.1 }
            },
            polyline: { encodedPolyline: "x" },
            legs: [
              {
                startLocation: { latLng: { latitude: 25, longitude: 121 } },
                endLocation: { latLng: { latitude: 25.1, longitude: 121.1 } }
              }
            ]
          }
        ]
      });
    },
    "server-only-key"
  );
  assert.equal(observedKey, "server-only-key");

  await assert.rejects(
    computeRoutes(baseRequest, async () => Response.json({ error: { message: "quota" } }, { status: 429 }), "key"),
    (error: unknown) => error instanceof UpstreamError && error.status === 503
  );
  await assert.rejects(
    computeRoutes(baseRequest, async () => Response.json({ error: { message: "denied" } }, { status: 403 }), "key"),
    (error: unknown) => error instanceof UpstreamError && error.status === 502
  );
});
