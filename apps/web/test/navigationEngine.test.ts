import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceNavigation,
  createInitialNavigationProgress,
  decodePolyline,
  gpsSignalState,
  navigationThresholds,
  prepareNavigationRoute,
  projectLocationToRoute
} from "../src/navigationEngine.js";
import { nextVoiceAnnouncement } from "../src/navigationVoice.js";
import type { RouteCoordinate, RouteOption, UserLocation } from "../src/types.js";

test("decodePolyline decodes the Google reference geometry", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    { lat: 38.5, lon: -120.2 },
    { lat: 40.7, lon: -120.95 },
    { lat: 43.252, lon: -126.453 }
  ]);
});

test("route projection and step progress follow eastbound geometry", () => {
  const route = fixtureRoute();
  const prepared = prepareNavigationRoute(route);
  const projection = projectLocationToRoute({ lat: 25.00005, lon: 121.006 }, prepared);
  assert.ok(projection.distanceToRouteMeters < 10);
  assert.ok(projection.bearing > 80 && projection.bearing < 100);

  const result = advanceNavigation(
    createInitialNavigationProgress(),
    fix(25.00005, 121.006, 8),
    prepared,
    "bicycle",
    1000
  );
  assert.equal(result.accepted, true);
  assert.equal(result.progress.stepIndex, 1);
  assert.ok(result.progress.remainingDistanceMeters > 300);
  assert.ok(result.progress.remainingDurationSeconds > 100);
});

test("low-accuracy fixes do not advance or trigger rerouting", () => {
  const prepared = prepareNavigationRoute(fixtureRoute());
  const initial = createInitialNavigationProgress();
  const result = advanceNavigation(initial, fix(25.01, 121.005, 80), prepared, "walk", 1000);
  assert.equal(result.accepted, false);
  assert.equal(result.shouldReroute, false);
  assert.equal(result.progress, initial);
});

test("off-route rerouting requires two fixes and honors cooldown", () => {
  const prepared = prepareNavigationRoute(fixtureRoute());
  const first = advanceNavigation(
    createInitialNavigationProgress(),
    fix(25.001, 121.005, 8),
    prepared,
    "walk",
    20000
  );
  assert.equal(first.shouldReroute, false);
  const second = advanceNavigation(first.progress, fix(25.001, 121.0051, 8), prepared, "walk", 21000);
  assert.equal(second.shouldReroute, true);

  const third = advanceNavigation(second.progress, fix(25.001, 121.0052, 8), prepared, "walk", 22000);
  const fourth = advanceNavigation(third.progress, fix(25.001, 121.0053, 8), prepared, "walk", 23000);
  assert.equal(fourth.shouldReroute, false);
  assert.deepEqual(navigationThresholds.walk, { offRouteMeters: 25, arrivalMeters: 20 });
});

test("arrival and GPS stale states use mode thresholds", () => {
  const prepared = prepareNavigationRoute(fixtureRoute());
  const arrived = advanceNavigation(
    createInitialNavigationProgress(),
    fix(25, 121.0099, 5),
    prepared,
    "walk",
    50000
  );
  assert.equal(arrived.progress.arrived, true);
  assert.equal(gpsSignalState(50000, 59000), "ok");
  assert.equal(gpsSignalState(50000, 61001), "weak");
  assert.equal(gpsSignalState(50000, 81001), "paused");
});

test("voice prompts are deduplicated by step and distance stage", () => {
  const route = fixtureRoute();
  const step = route.legs[0].steps[0];
  const spoken = new Set<string>();
  const first = nextVoiceAnnouncement({
    mode: "bicycle",
    step,
    stepIndex: 0,
    distanceMeters: 180,
    arrived: false,
    spokenKeys: spoken
  });
  assert.equal(first?.key, "step:0:distance:200");
  if (first) spoken.add(first.key);
  assert.equal(
    nextVoiceAnnouncement({
      mode: "bicycle",
      step,
      stepIndex: 0,
      distanceMeters: 180,
      arrived: false,
      spokenKeys: spoken
    }),
    undefined
  );
  assert.equal(
    nextVoiceAnnouncement({
      mode: "bicycle",
      step,
      stepIndex: 0,
      distanceMeters: 50,
      arrived: false,
      spokenKeys: spoken
    })?.key,
    "step:0:distance:60"
  );
});

function fixtureRoute(): RouteOption {
  const points: RouteCoordinate[] = [
    { lat: 25, lon: 121 },
    { lat: 25, lon: 121.005 },
    { lat: 25, lon: 121.01 }
  ];
  return {
    id: "route-1",
    labels: ["DEFAULT_ROUTE"],
    distanceMeters: 1010,
    durationSeconds: 600,
    viewport: { south: 24.99, west: 120.99, north: 25.01, east: 121.02 },
    polyline: encodePolyline(points),
    warnings: [],
    legs: [
      {
        id: "leg-1",
        distanceMeters: 1010,
        durationSeconds: 600,
        start: points[0],
        end: points[2],
        steps: [
          {
            id: "step-1",
            distanceMeters: 505,
            durationSeconds: 300,
            polyline: encodePolyline(points.slice(0, 2)),
            start: points[0],
            end: points[1],
            instruction: "直行",
            maneuver: "STRAIGHT",
            travelMode: "BICYCLE"
          },
          {
            id: "step-2",
            distanceMeters: 505,
            durationSeconds: 300,
            polyline: encodePolyline(points.slice(1)),
            start: points[1],
            end: points[2],
            instruction: "抵達目的地",
            maneuver: "DESTINATION",
            travelMode: "BICYCLE"
          }
        ]
      }
    ]
  };
}

function fix(lat: number, lon: number, accuracy: number): UserLocation {
  return { lat, lon, accuracy, timestamp: Date.now() };
}

function encodePolyline(points: RouteCoordinate[]) {
  let previousLatitude = 0;
  let previousLongitude = 0;
  return points
    .map((point) => {
      const latitude = Math.round(point.lat * 1e5);
      const longitude = Math.round(point.lon * 1e5);
      const value =
        encodeValue(latitude - previousLatitude) +
        encodeValue(longitude - previousLongitude);
      previousLatitude = latitude;
      previousLongitude = longitude;
      return value;
    })
    .join("");
}

function encodeValue(value: number) {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (shifted >= 0x20) {
    output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return output + String.fromCharCode(shifted + 63);
}
