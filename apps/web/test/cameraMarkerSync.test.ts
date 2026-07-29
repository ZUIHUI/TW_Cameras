import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraMarkerKey,
  planCameraMarkerSync,
  type CameraMarkerDescriptor
} from "../src/cameraMarkerSync.js";
import type { Camera } from "../src/types.js";

test("stable camera data does not rebuild the marker collection", () => {
  const cameras = [camera("one", 25.03, 121.56), camera("two", 24.15, 120.68)];
  const initial = planCameraMarkerSync(cameras, new Map());

  assert.deepEqual(
    initial.added.map((descriptor) => descriptor.key),
    [cameraMarkerKey("one"), cameraMarkerKey("two")]
  );

  const afterMapGesture = planCameraMarkerSync([...cameras].reverse(), initial.next);

  assert.deepEqual(afterMapGesture.added, []);
  assert.deepEqual(afterMapGesture.removedKeys, []);
  assert.deepEqual(afterMapGesture.replaced, []);
  assert.deepEqual(afterMapGesture.updated, []);
  assert.equal(afterMapGesture.next.size, 2);
});

test("camera coordinate changes replace only the affected marker", () => {
  const initial = planCameraMarkerSync(
    [camera("one", 25.03, 121.56), camera("two", 24.15, 120.68)],
    new Map()
  );
  const changed = planCameraMarkerSync(
    [camera("one", 25.031, 121.561), camera("two", 24.15, 120.68)],
    initial.next
  );

  assert.deepEqual(changed.replaced.map((descriptor) => descriptor.key), [cameraMarkerKey("one")]);
  assert.deepEqual(changed.added, []);
  assert.deepEqual(changed.removedKeys, []);
});

test("camera metadata updates and removals are reconciled independently", () => {
  const previous = new Map<string, CameraMarkerDescriptor>([
    [
      cameraMarkerKey("one"),
      {
        category: "city",
        key: cameraMarkerKey("one"),
        lat: 25.03,
        lon: 121.56,
        title: "Old title"
      }
    ],
    [
      cameraMarkerKey("removed"),
      {
        category: "freeway",
        key: cameraMarkerKey("removed"),
        lat: 25,
        lon: 121,
        title: "Removed"
      }
    ]
  ]);
  const changedCamera = camera("one", 25.03, 121.56, {
    category: "highway",
    title: "New title"
  });
  const changed = planCameraMarkerSync([changedCamera, camera("added", 23.5, 120.5)], previous);

  assert.deepEqual(changed.updated.map((descriptor) => descriptor.key), [cameraMarkerKey("one")]);
  assert.deepEqual(changed.added.map((descriptor) => descriptor.key), [cameraMarkerKey("added")]);
  assert.deepEqual(changed.removedKeys, [cameraMarkerKey("removed")]);
  assert.deepEqual(changed.replaced, []);
});

function camera(
  id: string,
  lat: number,
  lon: number,
  overrides: Partial<Camera> = {}
): Camera {
  return {
    attribution: "Test",
    category: "city",
    county: "Test County",
    id,
    lat,
    lon,
    roadName: "Test Road",
    source: "test",
    sourceCameraId: id,
    sourcePageUrl: "https://example.com",
    status: "online",
    streamType: "snapshot",
    streamUrl: "https://example.com/camera.jpg",
    title: `Camera ${id}`,
    town: "Test Town",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
