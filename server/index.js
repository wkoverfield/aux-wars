import { server } from "./server.js"

const PORT = process.env.PORT || 3001;

// Start server with error handling
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Aux Wars server started on port ${PORT}`);
  console.log(`[Server] Health check available at http://localhost:${PORT}/`);
  console.log(`[Server] Socket.IO endpoint at http://localhost:${PORT}/socket.io/`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('[Server] Error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
