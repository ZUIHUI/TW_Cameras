export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new UpstreamError(`Upstream responded ${response.status}: ${body.slice(0, 240)}`, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError(`Upstream request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
