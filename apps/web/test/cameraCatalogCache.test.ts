import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_CATALOG_CACHE_MAX_AGE_MS,
  CAMERA_CATALOG_CACHE_SCHEMA_VERSION,
  isUsableCameraCatalogCacheEntry
} from "../src/cameraCatalogCache.js";
import type { CameraCatalogResponse } from "../src/types.js";

const now = Date.UTC(2026, 6, 29, 8, 0, 0);

test("a recent camera catalog cache entry is usable", () => {
  const entry = {
    cachedAt: now - 60_000,
    catalog: catalog(),
    schemaVersion: CAMERA_CATALOG_CACHE_SCHEMA_VERSION
  };

  assert.equal(isUsableCameraCatalogCacheEntry(entry, now), true);
});

test("expired or incompatible camera catalog cache entries are rejected", () => {
  const validEntry = {
    cachedAt: now - CAMERA_CATALOG_CACHE_MAX_AGE_MS - 1,
    catalog: catalog(),
    schemaVersion: CAMERA_CATALOG_CACHE_SCHEMA_VERSION
  };

  assert.equal(isUsableCameraCatalogCacheEntry(validEntry, now), false);
  assert.equal(
    isUsableCameraCatalogCacheEntry(
      {
        ...validEntry,
        cachedAt: now,
        schemaVersion: CAMERA_CATALOG_CACHE_SCHEMA_VERSION + 1
      },
      now
    ),
    false
  );
  assert.equal(
    isUsableCameraCatalogCacheEntry(
      {
        ...validEntry,
        cachedAt: now,
        catalog: { cameras: [] }
      },
      now
    ),
    false
  );
});

function catalog(): CameraCatalogResponse {
  return {
    cache: {
      stale: false,
      updatedAt: "2026-07-29T08:00:00.000Z"
    },
    cameras: [],
    sourceErrors: [],
    summary: {
      cameras: {
        byCategory: {
          city: 0,
          freeway: 0,
          highway: 0,
          scenic: 0
        },
        byCounty: {},
        byStreamType: {
          hls: 0,
          mjpeg: 0,
          snapshot: 0,
          unknown: 0,
          webpage: 0
        },
        total: 0
      },
      sourceHealth: {
        errorCount: 0,
        status: "ok"
      },
      vehicleDetectors: {
        total: 0
      }
    },
    updatedAt: "2026-07-29T08:00:00.000Z",
    vehicleDetectors: []
  };
}
