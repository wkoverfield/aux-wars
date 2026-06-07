/**
 * Server Entry Point - Music Search Proxy
 *
 * Starts the Express server for the iTunes + Deezer music search API proxy
 */
import { server } from "./server.js";

const PORT = process.env.PORT || 3002;

// Start server with error handling
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Music Proxy] Server started on port ${PORT}`);
  console.log(`[Music Proxy] Health check: http://localhost:${PORT}/`);
  console.log(`[Music Proxy] Search endpoint: http://localhost:${PORT}/api/music/search`);
  console.log(`[Music Proxy] This server handles music search (iTunes + Deezer) only`);
  console.log(`[Music Proxy] Game logic is handled by Convex at http://127.0.0.1:3210`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('[Music Proxy] Error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Music Proxy] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[Music Proxy] Server closed');
    process.exit(0);
  });
});
