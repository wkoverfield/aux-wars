/**
 * Server Entry Point - YouTube Search Proxy
 *
 * Starts the Express server for YouTube search API proxy
 */
import { server } from "./server.js";

const PORT = process.env.PORT || 3002;

// Start server with error handling
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[YouTube Proxy] Server started on port ${PORT}`);
  console.log(`[YouTube Proxy] Health check: http://localhost:${PORT}/`);
  console.log(`[YouTube Proxy] Search endpoint: http://localhost:${PORT}/api/youtube/search`);
  console.log(`[YouTube Proxy] This server handles YouTube search only`);
  console.log(`[YouTube Proxy] Game logic is handled by Convex at http://127.0.0.1:3210`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('[YouTube Proxy] Error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[YouTube Proxy] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[YouTube Proxy] Server closed');
    process.exit(0);
  });
});
