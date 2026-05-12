export interface CacheResult<T> {
  value: T;
  updatedAt: string;
  stale: boolean;
  error?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  updatedAt: string;
}

class TimedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<CacheResult<unknown>>>();

  async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const now = Date.now();
    const current = this.entries.get(key) as CacheEntry<T> | undefined;

    if (current && current.expiresAt > now) {
      return { value: current.value, updatedAt: current.updatedAt, stale: false };
    }

    const pending = this.inFlight.get(key) as Promise<CacheResult<T>> | undefined;
    if (pending) {
      return pending;
    }

    const request = this.loadAndStore(key, ttlMs, loader, current);
    this.inFlight.set(key, request as Promise<CacheResult<unknown>>);

    try {
      return await request;
    } finally {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key);
      }
    }
  }

  private async loadAndStore<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    current?: CacheEntry<T>
  ): Promise<CacheResult<T>> {
    try {
      const value = await loader();
      const updatedAt = new Date().toISOString();
      this.entries.set(key, { value, expiresAt: Date.now() + ttlMs, updatedAt });
      return { value, updatedAt, stale: false };
    } catch (error) {
      if (!current) throw error;

      return {
        value: current.value,
        updatedAt: current.updatedAt,
        stale: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const timedCache = new TimedCache();
