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

  async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const now = Date.now();
    const current = this.entries.get(key) as CacheEntry<T> | undefined;

    if (current && current.expiresAt > now) {
      return { value: current.value, updatedAt: current.updatedAt, stale: false };
    }

    try {
      const value = await loader();
      const updatedAt = new Date().toISOString();
      this.entries.set(key, { value, expiresAt: now + ttlMs, updatedAt });
      return { value, updatedAt, stale: false };
    } catch (error) {
      if (current) {
        return {
          value: current.value,
          updatedAt: current.updatedAt,
          stale: true,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      throw error;
    }
  }
}

export const timedCache = new TimedCache();
