/**
 * Express Server - YouTube Search Proxy
 *
 * PURPOSE: Provides server-side YouTube search to bypass CORS restrictions
 * and enable use of the youtube-search-api scraping package.
 *
 * ARCHITECTURE NOTE: This server is intentionally separate from Convex.
 * - Convex: Handles all real-time game logic, state, mutations, queries
 * - Express: Handles YouTube search scraping (youtube-search-api package)
 *
 * Why not use Convex for YouTube search? See: convex/youtube.ts for details.
 * TL;DR: youtube-search-api package is incompatible with Convex runtime.
 */
import express from "express";
import http from "http";
import cors from "cors";
import youtubesearchapi from "youtube-search-api";

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
    message: 'Aux Wars YouTube Search Proxy',
    service: 'YouTube Search API',
    timestamp: new Date().toISOString()
  });
});

/**
 * YouTube Search Endpoint
 * Provides server-side YouTube search to bypass CORS restrictions
 *
 * @route POST /api/youtube/search
 * @body {string} query - Search query (min 2 characters)
 * @returns {Object} { tracks: Array } - Array of transformed track objects
 */
app.post('/api/youtube/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Valid search query is required' });
    }

    const result = await youtubesearchapi.GetListByKeyword(
      `${query} music`,
      false, // not playlist
      20,    // limit
      [{type: "video"}] // only videos
    );

    if (!result || !result.items || !Array.isArray(result.items)) {
      return res.json({ tracks: [] });
    }

    const tracks = result.items
      .map(transformToTrack)
      .filter(track => track !== null); // Remove any failed transformations

    res.json({ tracks });

  } catch (error) {
    console.error('YouTube search failed:', error);
    res.status(500).json({ error: 'Search service temporarily unavailable' });
  }
});

/**
 * Transforms YouTube search result to app's expected format
 * @param {Object} item - YouTube search result item
 * @returns {Object} Transformed track object
 */
function transformToTrack(item) {
  if (!item || !item.id) {
    return null;
  }

  // Try different thumbnail property paths
  const thumbnailUrl =
    item.thumbnail?.url ||
    item.thumbnails?.[0]?.url ||
    item.thumbnails?.high?.url ||
    item.thumbnails?.medium?.url ||
    item.thumbnails?.default?.url ||
    `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`; // Standard YouTube thumbnail format

  return {
    id: item.id,
    name: decodeHTMLEntities(item.title),
    artists: [{ name: decodeHTMLEntities(item.channelTitle || 'Unknown Artist') }],
    album: {
      name: "YouTube",
      images: [
        {
          url: thumbnailUrl
        }
      ]
    },
    preview_url: `https://www.youtube.com/embed/${item.id}`,
    duration_ms: 0, // Duration not available in search results
    external_url: `https://www.youtube.com/watch?v=${item.id}`
  };
}

/**
 * Decodes HTML entities in text
 * @param {string} text - Text with HTML entities
 * @returns {string} Decoded text
 */
function decodeHTMLEntities(text) {
  if (!text) return text;

  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}
