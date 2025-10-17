/**
 * YouTube Search - Convex Action Attempt (FAILED)
 *
 * ARCHITECTURAL DECISION: YouTube search is handled by Express server, not Convex.
 *
 * WHY THIS FILE EXISTS BUT ISN'T USED:
 * This file documents our attempts to use Convex Actions for YouTube search and
 * why we ultimately decided to keep Express for this specific functionality.
 *
 * ATTEMPTS MADE:
 *
 * 1. Regular Convex Action (without "use node"):
 *    - Result: Package 'youtube-search-api' resolved as undefined
 *    - Error: Cannot read properties of undefined (reading 'GetListByKeyword')
 *
 * 2. Node.js Runtime Action (with "use node" directive):
 *    - Result: HTTP Actions not allowed in Node.js runtime
 *    - Removed HTTP Action, kept regular Action only
 *    - Result: Still undefined - package incompatible with Convex Node environment
 *
 * WHY EXPRESS IS THE RIGHT SOLUTION:
 *
 * 1. Package Compatibility: youtube-search-api requires Node.js APIs and module
 *    resolution that don't work in Convex's sandboxed environment
 *
 * 2. Clear Separation: Express handles external API scraping, Convex handles
 *    real-time game logic - this is actually good architecture
 *
 * 3. Works Reliably: Express endpoint has no CORS issues, caching works,
 *    error handling is solid
 *
 * 4. Minimal Overhead: Express server is now single-purpose (just YouTube proxy)
 *    after Socket.IO removal
 *
 * CURRENT ARCHITECTURE:
 * - Express Server (port 3001): YouTube search proxy via /api/youtube/search
 * - Convex Backend (port 3210): Real-time game state, mutations, queries
 * - Client uses Express for search, Convex for everything else
 *
 * See: server/server.js for YouTube search implementation
 * See: client/src/services/serverYoutubeApi.js for client-side wrapper
 */

// This file intentionally left as documentation
// YouTube search is handled by Express server at /api/youtube/search
export {};
