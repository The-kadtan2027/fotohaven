/**
 * Process-local sliding-window rate limiter.
 *
 * Deployment note (ADR-006): FotoHaven runs a single Next.js instance under PM2.
 * If that changes, move buckets to SQLite/Redis; this module is deliberately
 * dependency-free and side-effect free.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

function prune(bucket: Bucket, now: number, windowMs: number) {
  const cutoff = now - windowMs;
  bucket.hits = bucket.hits.filter((timestamp) => timestamp > cutoff);
}

/**
 * Records an attempt and reports whether it is allowed.
 * Blocked attempts are also recorded, so hammering extends the lockout.
 */
export function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
  now = Date.now()
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  prune(bucket, now, options.windowMs);

  if (bucket.hits.length >= options.limit) {
    bucket.hits.push(now);
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, options.windowMs - (now - oldest)),
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, options.limit - bucket.hits.length),
    retryAfterMs: 0,
  };
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}

/** Test/maintenance hook. Never call from request paths. */
export function resetRateLimits() {
  buckets.clear();
}

export function rateLimitKey(scope: string, ...parts: Array<string | null | undefined>) {
  return [scope, ...parts.map((part) => (part ?? "").trim().toLowerCase())].join(":");
}

export function retryAfterSeconds(result: RateLimitResult): string {
  return String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
}
