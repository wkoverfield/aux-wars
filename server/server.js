/**
 * Express Server - Music Search Proxy
 *
 * PURPOSE: Provides server-side music search using the iTunes Search API and
 * Deezer API, returning 30-second preview clips that play via a plain HTML5
 * <audio> element on the client.
 *
 * ARCHITECTURE NOTE: This server is intentionally separate from Convex.
 * - Convex: Handles all real-time game logic, state, mutations, queries
 * - Express: Handles external music search (iTunes + Deezer) to avoid CORS
 *
 * Why these sources? Both expose free, no-key search endpoints that return a
 * direct 30s `preview` audio URL. Unlike embedded YouTube, this lets us run our
 * own ads without violating YouTube's API ToS and removes YouTube's own
 * pre-roll ads from snippet playback. Tradeoff: catalog is "officially released"
 * music only (loses bootleg/UGC/meme audio) and search is name-based.
 */
import express from "express";
import http from "http";
import cors from "cors";

export const app = express();
export const server = http.createServer(app);

// CORS configuration for allowed origins
const corsOriginFunction = (origin, callback) => {
  const allowedOrigins = [
    "https://aux-wars.com",
    "https://www.aux-wars.com",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174"
  ];

  // Allow requests with no origin (like mobile apps, curl, or proxied requests)
  if (!origin) return callback(null, true);

  // In development, allow any localhost origin
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return callback(null, true);
  }

  if (allowedOrigins.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
};

// Configure CORS for Express routes
app.use(cors({
  origin: corsOriginFunction,
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/**
 * Health check endpoint
 * Returns server status information
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Aux Wars Music Search Proxy',
    service: 'iTunes + Deezer Search',
    timestamp: new Date().toISOString()
  });
});

const SEARCH_LIMIT = 20;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Music Search Endpoint
 * Searches iTunes + Deezer in parallel for tracks with 30s preview clips.
 *
 * @route POST /api/music/search  (alias: /api/youtube/search for rollout safety)
 * @body {string} query - Search query (min 2 characters)
 * @returns {Object} { tracks: Array } - Array of transformed track objects
 */
async function handleSearch(req, res) {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Valid search query is required' });
    }

    const term = query.trim();

    // Query both sources in parallel; a failure in one must not sink the other.
    const [itunesResults, deezerResults] = await Promise.all([
      searchITunes(term).catch((e) => {
        console.error('iTunes search failed:', e?.message || e);
        return [];
      }),
      searchDeezer(term).catch((e) => {
        console.error('Deezer search failed:', e?.message || e);
        return [];
      }),
    ]);

    // Merge: iTunes first (broader coverage in testing), then Deezer extras.
    const tracks = mergeTracks(itunesResults, deezerResults).slice(0, SEARCH_LIMIT);

    res.json({ tracks });
  } catch (error) {
    console.error('Music search failed:', error);
    res.status(500).json({ error: 'Search service temporarily unavailable' });
  }
}

app.post('/api/music/search', handleSearch);
// Backwards-compatible alias so already-deployed clients keep working during rollout.
app.post('/api/youtube/search', handleSearch);

/**
 * Fetch JSON with a timeout so a slow upstream can't hang the request.
 */
async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Upstream responded ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * iTunes Search API → app track shape.
 * Docs: https://itunes.apple.com/search?term=...&media=music&entity=song
 */
async function searchITunes(query) {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    limit: String(SEARCH_LIMIT),
    country: 'US',
  });
  const data = await fetchJson(`https://itunes.apple.com/search?${params.toString()}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map(mapItunesTrack).filter(Boolean);
}

/**
 * Deezer search API → app track shape.
 * Docs: https://api.deezer.com/search?q=...
 */
async function searchDeezer(query) {
  const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) });
  const data = await fetchJson(`https://api.deezer.com/search?${params.toString()}`);
  const results = Array.isArray(data?.data) ? data.data : [];
  return results.map(mapDeezerTrack).filter(Boolean);
}

function mapItunesTrack(item) {
  if (!item || !item.trackId || !item.previewUrl) return null;
  const artwork = (item.artworkUrl100 || '').replace('100x100bb', '300x300bb');
  return {
    id: `itunes:${item.trackId}`,
    name: item.trackName || 'Unknown Track',
    artists: [{ name: item.artistName || 'Unknown Artist' }],
    album: {
      name: item.collectionName || '',
      images: [{ url: artwork }],
    },
    preview_url: item.previewUrl,
    duration_ms: item.trackTimeMillis || 0,
    external_url: item.trackViewUrl || '',
  };
}

function mapDeezerTrack(item) {
  if (!item || !item.id || !item.preview) return null;
  const album = item.album || {};
  return {
    id: `deezer:${item.id}`,
    name: item.title || 'Unknown Track',
    artists: [{ name: item.artist?.name || 'Unknown Artist' }],
    album: {
      name: album.title || '',
      images: [{ url: album.cover_medium || album.cover_big || album.cover || '' }],
    },
    preview_url: item.preview,
    duration_ms: (item.duration || 0) * 1000,
    external_url: item.link || '',
  };
}

/**
 * Merge two result lists, de-duplicating by normalized "name|artist".
 * Primary list wins on conflicts.
 */
function mergeTracks(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const track of [...primary, ...secondary]) {
    if (!track || !track.preview_url) continue;
    const key = dedupeKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(track);
  }
  return merged;
}

function dedupeKey(track) {
  const name = (track.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const artist = (track.artists?.[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${name}|${artist}`;
}
