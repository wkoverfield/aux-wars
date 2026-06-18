/**
 * Express Server - Music Search Proxy
 *
 * PURPOSE: Provides server-side music search. YouTube is the PRIMARY source
 * (full songs → players can clip any moment), with the iTunes Search API +
 * Deezer API as an automatic FALLBACK (free 30s previews) so the game keeps
 * working if the YouTube scraper is empty, errors, or times out.
 *
 * ARCHITECTURE NOTE: This server is intentionally separate from Convex.
 * - Convex: Handles all real-time game logic, state, mutations, queries
 * - Express: Handles external music search (YouTube + iTunes/Deezer) to avoid CORS
 *
 * Why YouTube primary? It has the full catalog (incl. bootleg/UGC/sped-up
 * audio iTunes/Deezer miss) and the full song, which is what lets the snippet
 * picker work. Why a fallback? `youtube-search-api` scrapes, so it can break;
 * iTunes/Deezer keep search alive when it does.
 *
 * ADS/ToS NOTE (dormant-but-real): running our OWN ads next to embedded YouTube
 * content violates YouTube's API ToS. We currently serve no ads
 * (VITE_ADSENSE_CLIENT unset → AdSlot renders nothing), so this is dormant. If
 * ads are ever re-enabled, gate YouTube playback to ad-free rooms first.
 */
import express from "express";
import http from "http";
import cors from "cors";
import youtubesearchapi from "youtube-search-api";
import { PostHog } from "posthog-node";

// Only init PostHog when a token is configured (Railway env). Without it —
// e.g. local dev or before the env var is set — fall back to a no-op stub so
// capture/captureException/shutdown calls never throw or spam errors.
const POSTHOG_TOKEN = process.env.POSTHOG_PROJECT_TOKEN;
export const posthog = POSTHOG_TOKEN
  ? new PostHog(POSTHOG_TOKEN, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      enableExceptionAutocapture: true,
    })
  : { capture() {}, captureException() {}, async shutdown() {} };

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
  allowedHeaders: ["Content-Type", "X-POSTHOG-DISTINCT-ID"]
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
// Keep the YouTube budget short so a slow/broken scraper falls back fast.
const YT_TIMEOUT_MS = 4000;

/**
 * Music Search Endpoint
 * YouTube-first (full songs); falls back to iTunes + Deezer 30s previews on
 * empty / error / timeout so the game never loses search.
 *
 * @route POST /api/music/search  (alias: /api/youtube/search for rollout safety)
 * @body {string} query - Search query (min 2 characters)
 * @returns {Object} { tracks: Array } - Array of transformed track objects
 */
async function handleSearch(req, res) {
  const distinctId = req.headers['x-posthog-distinct-id'] || 'anon';
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Valid search query is required' });
    }

    const term = query.trim();

    // 1) YouTube first — full songs let players clip any moment, and the
    //    catalog is far deeper. Fast-fail to the fallback on any problem.
    const ytTracks = await searchYouTube(term).catch((e) => {
      console.error('YouTube search failed:', e?.message || e);
      return [];
    });
    if (ytTracks.length > 0) {
      const resultTracks = ytTracks.slice(0, SEARCH_LIMIT);
      posthog.capture({
        distinctId,
        event: 'music_searched',
        properties: {
          query_length: term.length,
          source: 'youtube',
          result_count: resultTracks.length,
          $process_person_profile: false,
        },
      });
      return res.json({ tracks: resultTracks });
    }

    // 2) Fallback: iTunes + Deezer in parallel; a failure in one must not sink
    //    the other. Merge + relevance-rank across both, then cap.
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

    const tracks = mergeTracks(itunesResults, deezerResults, term).slice(0, SEARCH_LIMIT);

    if (tracks.length === 0) {
      posthog.capture({
        distinctId,
        event: 'music_search_no_results',
        properties: {
          query_length: term.length,
          $process_person_profile: false,
        },
      });
    } else {
      posthog.capture({
        distinctId,
        event: 'music_searched',
        properties: {
          query_length: term.length,
          source: 'itunes_deezer_fallback',
          result_count: tracks.length,
          $process_person_profile: false,
        },
      });
    }

    res.json({ tracks });
  } catch (error) {
    console.error('Music search failed:', error);
    posthog.captureException(error, distinctId, { endpoint: '/api/music/search' });
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
 * YouTube search via `youtube-search-api` (scrapes, no key) → app track shape.
 * Wrapped in a timeout so a slow/broken scraper fails fast to the fallback.
 * YouTube tracks carry a `videoId` and NO `preview_url` (full-song IFrame
 * playback); that absence is how the client tells the two sources apart.
 */
async function searchYouTube(query) {
  const result = await Promise.race([
    youtubesearchapi.GetListByKeyword(query, false, SEARCH_LIMIT, [{ type: 'video' }]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('YouTube timeout')), YT_TIMEOUT_MS)),
  ]);
  const items = Array.isArray(result?.items) ? result.items : [];
  return items
    .filter((it) => it && it.type === 'video' && it.id && !it.isLive)
    .map(mapYouTubeTrack)
    .filter(Boolean);
}

function mapYouTubeTrack(item) {
  const thumbs = item.thumbnail?.thumbnails || [];
  const thumb = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || '';
  const { name, artist } = cleanTitle(item.title, item.channelTitle);
  return {
    id: `youtube:${item.id}`,
    videoId: item.id,
    name,
    artists: [{ name: artist }],
    album: { name: '', images: [{ url: thumb }] },
    preview_url: null, // full song plays via the YouTube IFrame, not a 30s clip
    duration_ms: parseLength(item.length?.simpleText),
    external_url: `https://www.youtube.com/watch?v=${item.id}`,
  };
}

/**
 * Turn a messy YouTube title into { name, artist }. Strips decoration like
 * "(Official Video)" / "[HD]" / "(Lyrics)", splits "Artist - Title", and
 * otherwise falls back to the channel name (minus " - Topic" / "VEVO").
 */
function cleanTitle(rawTitle, channelTitle) {
  let t = (rawTitle || '').trim();
  t = t.replace(
    /[([][^)\]]*\b(official|lyric|lyrics|audio|video|music\s*video|visualizer|mv|hd|hq|4k|explicit|clean|remaster(?:ed)?|prod\.?)\b[^)\]]*[)\]]/gi,
    ''
  );
  t = t.replace(/\s{2,}/g, ' ').trim();

  const dash = t.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (dash) {
    return { name: (dash[2].trim() || rawTitle || 'Unknown Track'), artist: dash[1].trim() };
  }
  const artist = (channelTitle || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim() || 'Unknown Artist';
  return { name: t || rawTitle || 'Unknown Track', artist };
}

/** "3:45" → 225000 ms; "1:02:03" → 3723000 ms; bad/missing input → 0. */
function parseLength(s) {
  if (!s || typeof s !== 'string') return 0;
  const parts = s.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let secs = 0;
  if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else secs = parts[0];
  return secs * 1000;
}

/**
 * Merge two result lists, de-duplicating by normalized "name|artist", then
 * relevance-rank against the query so the best match from EITHER source floats
 * to the top — instead of dumping all of source A before any of source B
 * (which buried exact matches past the result cap).
 */
function mergeTracks(primary, secondary, query = '') {
  const seen = new Set();
  const merged = [];
  for (const track of [...primary, ...secondary]) {
    if (!track || !track.preview_url) continue;
    const key = dedupeKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(track);
  }

  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const score = (track) => {
    const name = (track.name || '').toLowerCase();
    const artist = (track.artists?.[0]?.name || '').toLowerCase();
    let covered = 0; // distinct query words found anywhere (the main signal)
    let artistHits = 0; // mild tiebreak toward artist matches
    for (const tok of tokens) {
      const inName = name.includes(tok);
      const inArtist = artist.includes(tok);
      if (inName || inArtist) covered += 1;
      if (inArtist) artistHits += 1;
    }
    let s = covered * 2 + artistHits;
    // Deprioritize obvious non-original variants when better matches exist.
    if (/instrumental|karaoke|tribute|\bcover\b|made famous|originally performed/i.test(name)) {
      s -= 3;
    }
    return s;
  };

  // Stable sort: equal scores keep their original (source) order.
  return merged
    .map((track, i) => ({ track, i, s: score(track) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.track);
}

function dedupeKey(track) {
  const name = (track.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const artist = (track.artists?.[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${name}|${artist}`;
}
