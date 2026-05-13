import { logger } from "../logger.js";

interface CachedFetchOpts<T> {
  name: string;
  ttlMs: number;
  errorRetryMs: number;
  fetch: () => Promise<T[]>;
}

interface Cache<T> {
  fetchedAt: number;
  entries: T[];
}

export function createCachedFetch<T>(opts: CachedFetchOpts<T>) {
  let cache: Cache<T> | null = null;

  async function get(): Promise<T[]> {
    if (cache && Date.now() - cache.fetchedAt < opts.ttlMs) {
      return cache.entries;
    }
    try {
      const entries = await opts.fetch();
      cache = { fetchedAt: Date.now(), entries };
      return entries;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        `${opts.name} fetch failed`,
      );
      // 에러 시 짧은 TTL로 빈 결과 캐시 — errorRetryMs 후 재시도.
      cache = {
        fetchedAt: Date.now() - (opts.ttlMs - opts.errorRetryMs),
        entries: [],
      };
      return [];
    }
  }

  function clear(): void {
    cache = null;
  }

  return { get, clear };
}
