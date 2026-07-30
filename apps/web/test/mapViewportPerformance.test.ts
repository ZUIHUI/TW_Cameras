import assert from "node:assert/strict";
import test from "node:test";
import {
  mapViewportTargetKey,
  normalizeMapViewportTarget
} from "../src/mapViewportPerformance.js";

test("nearby idle events share one viewport data key", () => {
  const first = normalizeMapViewportTarget({
    lat: 25.03341,
    lon: 121.56448,
    title: "Map center"
  });
  const second = normalizeMapViewportTarget({
    lat: 25.03344,
    lon: 121.56446,
    title: "Map center"
  });

  assert.deepEqual(first, {
    lat: 25.033,
    lon: 121.564,
    title: "Map center"
  });
  assert.equal(mapViewportTargetKey(first), mapViewportTargetKey(second));
});

test("a meaningful map move receives a new viewport data key", () => {
  const previous = { lat: 25.033, lon: 121.564 };
  const moved = normalizeMapViewportTarget({
    lat: 25.035,
    lon: 121.567,
    title: "Map center"
  });

  assert.notEqual(mapViewportTargetKey(previous), mapViewportTargetKey(moved));
});
