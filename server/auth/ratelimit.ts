/** Eenvoudige in-memory limiter voor mislukte logins (per sleutel, schuivend venster). */
export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; reset: number }>();

  const entry = (key: string) => {
    const t = now();
    const e = hits.get(key);
    if (!e || e.reset <= t) {
      const fresh = { count: 0, reset: t + opts.windowMs };
      hits.set(key, fresh);
      return fresh;
    }
    return e;
  };

  return {
    /** Seconden tot de volgende poging mag, of 0 als er nog pogingen over zijn. */
    blockedFor(key: string): number {
      const e = entry(key);
      return e.count >= opts.max ? Math.ceil((e.reset - now()) / 1000) : 0;
    },
    fail(key: string) {
      entry(key).count += 1;
      if (hits.size > 10_000) {
        const t = now();
        for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      }
    },
    reset(key: string) {
      hits.delete(key);
    }
  };
}
