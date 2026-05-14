import type {
  CameraCatalogResponse,
  EnvironmentSummary,
  NearbyTourismResponse,
  RadarOverlayResponse,
  RainfallResponse
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const API_TIMEOUT_MS = 12000;
const API_RETRY_DELAY_MS = 500;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const maxAttempts = shouldRetry(init) ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchJsonOnce<T>(path, init);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await delay(API_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJsonOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init?.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const message = typeof body?.message === "string" ? body.message : `API request failed: ${response.status}`;
      throw new Error(message);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("來源回應逾時，請稍後再試。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function shouldRetry(init?: RequestInit) {
  const method = init?.method?.toUpperCase() || "GET";
  return method === "GET";
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getCameras(): Promise<CameraCatalogResponse> {
  return fetchJson<CameraCatalogResponse>("/cameras");
}

export function getEnvironment(county: string): Promise<EnvironmentSummary> {
  return fetchJson<EnvironmentSummary>(`/environment?county=${encodeURIComponent(county)}`);
}

export function getEnvironmentByCoordinate(lat: number, lon: number): Promise<EnvironmentSummary> {
  const searchParams = new URLSearchParams({
    lat: String(lat),
    lon: String(lon)
  });
  return fetchJson<EnvironmentSummary>(`/environment/coordinate?${searchParams.toString()}`);
}

export function getRadarOverlay(): Promise<RadarOverlayResponse> {
  return fetchJson<RadarOverlayResponse>("/radar");
}

export function getRainfallNearby(lat: number, lon: number, radius = 15000, limit = 8): Promise<RainfallResponse> {
  const searchParams = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(radius),
    limit: String(limit)
  });
  return fetchJson<RainfallResponse>(`/rainfall?${searchParams.toString()}`);
}

export function getNearbyTourism(lat: number, lon: number, radius = 3000): Promise<NearbyTourismResponse> {
  const searchParams = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(radius)
  });
  return fetchJson<NearbyTourismResponse>(`/nearby-tourism?${searchParams.toString()}`);
}
