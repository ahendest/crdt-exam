import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { setupWSConnection } from "./yjs-ws-server";

// Single HTTP server that also upgrades to WebSocket
const PORT = process.env.PORT ? Number(process.env.PORT) : 1234;

const server = http.createServer((req, res) => {
  // Simple health check / debug endpoint
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Yjs WebSocket server is running\n");
});

// WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

// For now we use a single shared document name for all connections.
// Later, robots & browser just connect to ws://localhost:1234 and share this doc.
const DOC_NAME = "shared-doc";

wss.on("connection", (conn: WebSocket, req) => {
  console.log("New WebSocket connection");
  setupWSConnection(conn, req, { docName: DOC_NAME });
});

// Start listening
server.listen(PORT, () => {
  console.log(`Yjs WebSocket server listening on http://localhost:${PORT}`);
});
