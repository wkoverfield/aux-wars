/**
 * Rate limiting for the music search endpoint.
 *
 * Two token buckets: one per client, and one shared by everyone. The per-client
 * bucket stops one caller hammering search; the global bucket caps total load
 * on the YouTube scraper and the fallback APIs even if a caller rotates
 * addresses. Sizes leave room for a whole party searching from one network
 * (several players behind the same IP).
 *
 * The limiter runs in one of two modes, read from SEARCH_RATE_LIMIT:
 * - "enforce": over-limit requests get 429 with Retry-After.
 * - anything else (default): requests always pass; the limiter only counts
 *   what it would have blocked, in the once-a-minute summary log.
 *
 * Client key: requests reach this server through the site's /api rewrite on
 * Vercel (which sets x-forwarded-for to the visitor's address) and Railway's
 * proxy. The summary log reports how the key was found (never the addresses
 * themselves) so the key can be confirmed before enforcing.
 */

export const CLIENT_LIMIT = { capacity: 60, refillPerSec: 2 };
export const GLOBAL_LIMIT = { capacity: 600, refillPerSec: 20 };
const IDLE_BUCKET_MS = 10 * 60 * 1000;
const SUMMARY_MS = 60 * 1000;

/** A token bucket that refills continuously; `take` spends one token if available. */
export function createBucket({ capacity, refillPerSec }, now) {
  return { tokens: capacity, capacity, refillPerSec, updatedAt: now };
}

export function take(bucket, now) {
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSec);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterSec: 0 };
  }
  return { ok: false, retryAfterSec: Math.ceil((1 - bucket.tokens) / bucket.refillPerSec) };
}

/**
 * The caller's address and where it came from: the first x-forwarded-for
 * entry, else x-real-ip, else the socket.
 */
export function clientKey(req) {
  const xff = req.headers['x-forwarded-for'];
  const first = typeof xff === 'string' ? xff.split(',')[0].trim() : '';
  if (first) return { key: first, source: 'xff', hops: xff.split(',').length };
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return { key: realIp.trim(), source: 'x-real-ip', hops: 0 };
  return { key: req.socket?.remoteAddress || 'unknown', source: 'socket', hops: 0 };
}

export function createSearchRateLimiter({
  enforce = process.env.SEARCH_RATE_LIMIT === 'enforce',
  clock = () => Date.now(),
  log = (line) => console.log(line),
  summaryEveryMs = SUMMARY_MS,
} = {}) {
  const clients = new Map();
  let globalBucket = createBucket(GLOBAL_LIMIT, clock());
  let stats = freshStats();

  function freshStats() {
    return { requests: 0, keys: new Map(), sources: {}, hops: {}, overClient: 0, overGlobal: 0, startedAt: clock() };
  }

  function summarize(now) {
    if (now - stats.startedAt < summaryEveryMs) return;
    if (stats.requests > 0) {
      const maxPerKey = Math.max(0, ...stats.keys.values());
      log(
        `[search-rate] mode=${enforce ? 'enforce' : 'log-only'} requests=${stats.requests} ` +
          `clients=${stats.keys.size} max_per_client=${maxPerKey} ` +
          `over_client=${stats.overClient} over_global=${stats.overGlobal} ` +
          `key_source=${JSON.stringify(stats.sources)} xff_hops=${JSON.stringify(stats.hops)}`
      );
    }
    for (const [key, bucket] of clients) {
      if (now - bucket.updatedAt > IDLE_BUCKET_MS) clients.delete(key);
    }
    stats = freshStats();
  }

  return function searchRateLimit(req, res, next) {
    const now = clock();
    summarize(now);
    const { key, source, hops } = clientKey(req);
    stats.requests += 1;
    stats.keys.set(key, (stats.keys.get(key) || 0) + 1);
    stats.sources[source] = (stats.sources[source] || 0) + 1;
    stats.hops[hops] = (stats.hops[hops] || 0) + 1;

    let bucket = clients.get(key);
    if (!bucket) {
      bucket = createBucket(CLIENT_LIMIT, now);
      clients.set(key, bucket);
    }
    let verdict = take(bucket, now);
    if (!verdict.ok) {
      stats.overClient += 1;
    } else {
      verdict = take(globalBucket, now);
      if (!verdict.ok) stats.overGlobal += 1;
    }

    if (verdict.ok || !enforce) return next();
    res.set('Retry-After', String(verdict.retryAfterSec));
    return res.status(429).json({ error: 'Too many searches. Try again in a moment.' });
  };
}
