import { UpstreamError } from "./http.js";

export const API_CACHE_HEADERS = {
  "cache-control": "s-maxage=60, stale-while-revalidate=600"
};

export const CAMERA_CATALOG_CACHE_HEADERS = {
  "cache-control": "public, max-age=60",
  "vercel-cdn-cache-control": "public, max-age=1200, stale-while-revalidate=86400"
};

export function cachedJson(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...API_CACHE_HEADERS,
      ...(init.headers || {})
    }
  });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof UpstreamError) {
    return Response.json(
      {
        error: "upstream_error",
        message: error.message
      },
      { status: error.status === 503 ? 503 : error.status >= 500 ? 502 : error.status }
    );
  }

  return Response.json(
    {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    },
    { status: 500 }
  );
}
