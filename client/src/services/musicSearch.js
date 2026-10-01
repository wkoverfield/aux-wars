/**
 * Music search service
 * Calls our Express backend (/api/music/search) which queries the iTunes
 * Search API + Deezer and returns tracks with 30-second preview clips.
 */
import { getVisitorId } from "../utils/visitorId";

// In-memory cache with TTL (Time To Live)
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Request queue to prevent duplicate simultaneous searches
const pendingRequests = new Map();

// Failure backoff: after MAX_RETRIES consecutive failures for a query, the
// query is not re-fetched until FAILURE_BACKOFF_MS has passed.
const errorCounts = new Map(); // cacheKey -> { count, reason, at }
const MAX_RETRIES = 3;
const FAILURE_BACKOFF_MS = 30 * 1000;

export const SEARCH_TIMEOUT_MS = 8000;

/**
 * A search that did not produce an answer (as opposed to an empty result).
 * reason: "timeout" | "network" | "http_<status>" | "bad_payload".
 * fromBackoff is true when no request was made because the same query failed
 * repeatedly just before.
 */
export class SearchError extends Error {
  constructor(reason, { fromBackoff = false } = {}) {
    super(`Music search failed: ${reason}`);
    this.name = "SearchError";
    this.reason = reason;
    this.fromBackoff = fromBackoff;
  }
}

function failureReason(err) {
  if (err instanceof SearchError) return err.reason;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return "timeout";
  // Anything else: fetch rejects with a TypeError when the request never got
  // a response (offline, DNS, blocked host, CORS).
  return "network";
}

/**
 * Performs one request. Resolves with the tracks array (possibly empty) on a
 * well-formed 200; rejects with a SearchError otherwise.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of track objects
 */
async function fetchTracks(query) {
  // Use Express endpoint via Vite proxy in dev, explicit URL in prod
  const baseUrl = import.meta.env.VITE_SERVER_URL || '';
  const endpoint = baseUrl ? `${baseUrl}/api/music/search` : '/api/music/search';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-POSTHOG-DISTINCT-ID': getVisitorId(),
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new SearchError(failureReason(err));
    }

    if (!response.ok) {
      throw new SearchError(`http_${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      // An abort while the body streams is still a timeout.
      throw new SearchError(err?.name === "AbortError" ? "timeout" : "bad_payload");
    }
    if (!data || typeof data !== "object" || data.error || !Array.isArray(data.tracks)) {
      throw new SearchError("bad_payload");
    }
    return data.tracks;
  } finally {
    clearTimeout(timer);
  }
}

async function performSearch(query, cacheKey) {
  try {
    const tracks = await fetchTracks(query);
    searchCache.set(cacheKey, { results: tracks, timestamp: Date.now() });
    errorCounts.delete(cacheKey);
    return tracks;
  } catch (err) {
    const reason = failureReason(err);
    const previous = errorCounts.get(cacheKey);
    errorCounts.set(cacheKey, { count: (previous?.count ?? 0) + 1, reason, at: Date.now() });

    // Stale results beat an error message.
    const stale = searchCache.get(cacheKey);
    if (stale) return stale.results;
    throw new SearchError(reason);
  }
}

/**
 * Searches for music tracks with caching and request deduplication.
 *
 * Resolves with an array: the server's tracks (empty only when the search
 * genuinely matched nothing), or stale cached tracks when a refresh failed.
 * Rejects with a SearchError when the search failed and nothing is cached.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of track objects
 */
export async function searchTracks(query) {
  // Validate input
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return [];
  }

  const cacheKey = query.toLowerCase().trim();

  // Fresh cache first
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  // Back off a query that keeps failing
  const errors = errorCounts.get(cacheKey);
  if (errors && errors.count >= MAX_RETRIES && Date.now() - errors.at < FAILURE_BACKOFF_MS) {
    if (cached) return cached.results;
    throw new SearchError(errors.reason, { fromBackoff: true });
  }

  // Check if request is already pending (deduplication)
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  const requestPromise = performSearch(query, cacheKey);
  pendingRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    pendingRequests.delete(cacheKey);
  }
}

/**
 * Gets cached results immediately without making a request
 * @param {string} query - Search query
 * @returns {Array|null} Cached results or null if not found
 */
export function getCachedResults(query) {
  if (!query) return null;

  const cacheKey = query.toLowerCase().trim();
  const cached = searchCache.get(cacheKey);
  return cached ? cached.results : null;
}

/**
 * Preemptively caches search results (for popular searches)
 * @param {string} query - Search query
 * @param {Array} results - Search results to cache
 */
export function cacheSearchResults(query, results) {
  if (!query || !Array.isArray(results)) return;

  const cacheKey = query.toLowerCase().trim();
  searchCache.set(cacheKey, {
    results: results,
    timestamp: Date.now()
  });
}

/**
 * Clears old entries from cache to prevent memory leaks
 */
export function cleanupCache() {
  const now = Date.now();
  const expiredKeys = [];

  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL * 2) { // Keep for 2x TTL
      expiredKeys.push(key);
    }
  }

  expiredKeys.forEach(key => {
    searchCache.delete(key);
    errorCounts.delete(key);
  });

  for (const [key, value] of errorCounts.entries()) {
    if (now - value.at > CACHE_TTL * 2) errorCounts.delete(key);
  }

}

/**
 * Gets cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  return {
    cacheSize: searchCache.size,
    pendingRequests: pendingRequests.size,
    errorCounts: errorCounts.size
  };
}

// Set up periodic cache cleanup
setInterval(cleanupCache, 10 * 60 * 1000); // Every 10 minutes

// No authentication required for this API
export function isTokenValid() {
  return true;
}

export function getTokenDebugInfo() {
  return {
    authenticated: true,
    service: "Music Search (iTunes + Deezer, No Auth)",
    requiresUserAuth: false,
    cacheStats: getCacheStats()
  };
}
