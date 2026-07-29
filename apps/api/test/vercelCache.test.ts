import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_CATALOG_CACHE_HEADERS, cachedJson } from "../src/vercel.js";

test("camera catalog responses use a short browser cache and a durable Vercel edge cache", () => {
  const response = cachedJson(
    { cameras: [] },
    {
      headers: CAMERA_CATALOG_CACHE_HEADERS
    }
  );

  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  assert.equal(
    response.headers.get("vercel-cdn-cache-control"),
    "public, max-age=1200, stale-while-revalidate=86400"
  );
});
