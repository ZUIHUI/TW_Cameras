import { UpstreamError } from "../http.js";
import type { Camera } from "../types.js";

const STREAM_HEADER_TIMEOUT_MS = 12000;
const CAMERA_STREAM_CACHE_CONTROL = "no-store, max-age=0";
const STREAM_RESPONSE_HEADERS = [
  "accept-ranges",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified"
];

export interface CameraStreamRequestHeaders {
  accept?: string | null;
  range?: string | null;
  userAgent?: string | null;
}

export const CAMERA_STREAM_CORS_HEADERS = {
  "access-control-allow-headers": "Accept, Range",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type"
};

export async function fetchCameraStreamResponse(
  camera: Camera,
  requestUrl: string,
  requestHeaders: CameraStreamRequestHeaders = {}
): Promise<Response> {
  if (camera.streamType === "webpage") {
    throw new UpstreamError("This camera source is a webpage and cannot be proxied as a stream.", 400);
  }

  const targetUrl = resolveCameraStreamTarget(camera.streamUrl, requestUrl);
  const upstream = await fetchUpstreamStream(targetUrl, requestHeaders);
  const contentType = upstream.headers.get("content-type") || fallbackContentType(camera, targetUrl);
  const responseHeaders = copyStreamHeaders(upstream.headers);

  responseHeaders.set("cache-control", CAMERA_STREAM_CACHE_CONTROL);
  responseHeaders.set("content-type", contentType);
  responseHeaders.set("cross-origin-resource-policy", "cross-origin");
  for (const [key, value] of Object.entries(CAMERA_STREAM_CORS_HEADERS)) {
    responseHeaders.set(key, value);
  }

  if (isHlsPlaylist(targetUrl, contentType)) {
    const playlist = await upstream.text();
    const rewrittenPlaylist = rewriteHlsPlaylist(playlist, targetUrl, requestUrl);
    responseHeaders.delete("content-length");
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    return new Response(rewrittenPlaylist, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText
    });
  }

  return new Response(upstream.body, {
    headers: responseHeaders,
    status: upstream.status,
    statusText: upstream.statusText
  });
}

function resolveCameraStreamTarget(cameraStreamUrl: string, requestUrl: string): URL {
  const originalUrl = toHttpUrl(cameraStreamUrl, "Camera stream URL is invalid.");
  const requestedTarget = new URL(requestUrl, "http://localhost").searchParams.get("url");
  if (!requestedTarget) {
    return originalUrl;
  }

  const targetUrl = toHttpUrl(requestedTarget, "Requested stream segment URL is invalid.");
  if (!isAllowedStreamTarget(originalUrl, targetUrl)) {
    throw new UpstreamError("Requested stream segment is outside the camera source host.", 403);
  }

  return targetUrl;
}

async function fetchUpstreamStream(
  targetUrl: URL,
  requestHeaders: CameraStreamRequestHeaders
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_HEADER_TIMEOUT_MS);

  try {
    const headers = new Headers({
      accept: requestHeaders.accept || "*/*",
      "user-agent":
        requestHeaders.userAgent ||
        "Mozilla/5.0 (compatible; TaiwanLiveCamera/1.0; +https://taiwan-live-cam.local)"
    });

    if (requestHeaders.range) {
      headers.set("range", requestHeaders.range);
    }

    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new UpstreamError(`Camera stream responded ${response.status}.`, response.status);
    }

    return response;
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError(`Camera stream timed out after ${STREAM_HEADER_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function copyStreamHeaders(headers: Headers): Headers {
  const responseHeaders = new Headers();

  for (const header of STREAM_RESPONSE_HEADERS) {
    const value = headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }

  return responseHeaders;
}

function rewriteHlsPlaylist(playlist: string, playlistUrl: URL, requestUrl: string): string {
  return playlist
    .split(/\r?\n/)
    .map((line) => rewriteHlsPlaylistLine(line, playlistUrl, requestUrl))
    .join("\n");
}

function rewriteHlsPlaylistLine(line: string, playlistUrl: URL, requestUrl: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }

  if (trimmed.startsWith("#")) {
    return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
      return `URI="${buildProxiedStreamUrl(uri, playlistUrl, requestUrl)}"`;
    });
  }

  return buildProxiedStreamUrl(trimmed, playlistUrl, requestUrl);
}

function buildProxiedStreamUrl(value: string, baseUrl: URL, requestUrl: string): string {
  if (value.startsWith("data:")) {
    return value;
  }

  const absoluteUrl = new URL(value, baseUrl);
  const proxiedUrl = new URL(requestUrl, "http://localhost");
  proxiedUrl.search = "";
  proxiedUrl.searchParams.set("url", absoluteUrl.toString());
  return `${proxiedUrl.pathname}${proxiedUrl.search}`;
}

function isHlsPlaylist(targetUrl: URL, contentType: string): boolean {
  const lowerPath = targetUrl.pathname.toLowerCase();
  const lowerContentType = contentType.toLowerCase();

  return (
    lowerPath.endsWith(".m3u8") ||
    lowerContentType.includes("mpegurl") ||
    lowerContentType.includes("vnd.apple.mpegurl")
  );
}

function fallbackContentType(camera: Camera, targetUrl: URL): string {
  const lowerPath = targetUrl.pathname.toLowerCase();
  if (camera.streamType === "hls" || lowerPath.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  if (camera.streamType === "snapshot" || /\.(jpe?g|png|webp)$/.test(lowerPath)) {
    return lowerPath.endsWith(".png") ? "image/png" : lowerPath.endsWith(".webp") ? "image/webp" : "image/jpeg";
  }
  if (camera.streamType === "mjpeg") {
    return "multipart/x-mixed-replace";
  }
  return "application/octet-stream";
}

function toHttpUrl(value: string, errorMessage: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UpstreamError(errorMessage, 400);
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new UpstreamError(errorMessage, 400);
  }

  return url;
}

function isAllowedStreamTarget(originalUrl: URL, targetUrl: URL): boolean {
  return originalUrl.hostname.toLowerCase() === targetUrl.hostname.toLowerCase();
}
