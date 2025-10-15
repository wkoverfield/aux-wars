/**
 * Server-side YouTube Search API service
 * Calls our backend endpoint which uses youtube-search-api to bypass CORS restrictions
 */

// In-memory cache with TTL (Time To Live)
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Request queue to prevent duplicate simultaneous searches
const pendingRequests = new Map();

// Error tracking for exponential backoff
const errorCounts = new Map();
const MAX_RETRIES = 3;

// Server endpoint URL

/**
 * Performs the actual YouTube search with error handling
 * @param {string} query - Search query
 * @param {string} cacheKey - Cache key for storing results
 * @returns {Promise<Array>} Array of track objects
 */
async function performSearch(query, cacheKey) {
  try {
    // Use Express endpoint via Vite proxy in dev, explicit URL in prod
    const baseUrl = import.meta.env.VITE_SERVER_URL || '';
    const endpoint = baseUrl ? `${baseUrl}/api/youtube/search` : '/api/youtube/search';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }

    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    
    
    // Cache successful results
    searchCache.set(cacheKey, {
      results: tracks,
      timestamp: Date.now()
    });

    // Reset error count on success
    errorCounts.delete(cacheKey);

    return tracks;

  } catch (error) {
    
    // Increment error count for this query
    const currentErrors = errorCounts.get(cacheKey) || 0;
    errorCounts.set(cacheKey, currentErrors + 1);
    
    // Return cached stale data if available
    const stale = searchCache.get(cacheKey);
    if (stale) {
      return stale.results;
    }
    
    // If no cache available, return empty array rather than throwing
    return [];
  }
}

/**
 * Searches YouTube for music videos with caching and request deduplication
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of track objects
 */
export async function searchTracks(query) {
  // Validate input
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return [];
  }

  const cacheKey = query.toLowerCase().trim();
  
  // Check if we should skip due to too many recent errors
  const errorCount = errorCounts.get(cacheKey) || 0;
  if (errorCount >= MAX_RETRIES) {
    const stale = searchCache.get(cacheKey);
    return stale ? stale.results : [];
  }
  
  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  // Check if request is already pending (deduplication)
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  // Create new request with timeout
  const requestPromise = Promise.race([
    performSearch(query, cacheKey),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Search timeout')), 10000)
    )
  ]);
  
  pendingRequests.set(cacheKey, requestPromise);

  try {
    const results = await requestPromise;
    return results;
  } catch (error) {
    
    // Return cached data if available, even if stale
    const stale = searchCache.get(cacheKey);
    return stale ? stale.results : [];
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
    service: "Server-side YouTube Search (No Auth)",
    requiresUserAuth: false,
    cacheStats: getCacheStats()
  };
}