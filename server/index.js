import { server } from "./server.js"

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`[Server] Aux Wars server started on port ${PORT}`);
  console.log(`[Server] Health check available at http://localhost:${PORT}/`);
  console.log(`[Server] Socket.IO endpoint at http://localhost:${PORT}/socket.io/`);
});
