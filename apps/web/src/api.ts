import type { CameraCatalogResponse, EnvironmentSummary } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
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
}

export function getCameras(): Promise<CameraCatalogResponse> {
  return fetchJson<CameraCatalogResponse>("/cameras");
}

export function getEnvironment(county: string): Promise<EnvironmentSummary> {
  return fetchJson<EnvironmentSummary>(`/environment?county=${encodeURIComponent(county)}`);
}
