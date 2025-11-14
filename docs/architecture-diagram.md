# CRDT Collab Architecture Diagram

The diagram below outlines the major runtime components, their responsibilities, and the data flows that enable collaborative editing across browsers, robots, and the Yjs sync server.

```mermaid
graph TD
  subgraph Browser Clients (React)
    A1[App.js\n- Initializes Y.Doc\n- WebsocketProvider binding\n- UndoManager tracked by clientId\n- Awareness state (name, color)\n- Textarea diffing + CRDT transactions]
  end

  subgraph Robot Clients (Node.js)
    B1[robots/src/robot-a.ts\n- Headless Y.Doc\n- WebsocketProvider\n- Stable client identity file\n- Scripted edit/undo scenario]
  end

  subgraph Sync Server (Node.js)
    C1[server/src/index.ts\n- HTTP health endpoint\n- Hosts WebSocketServer\n- Forwards connections]
    C2[server/src/yjs-ws-server.ts\n- WSSharedDoc registry\n- Awareness multiplexing\n- Mutex-protected sync handling\n- Persist Y.Doc state to disk]
  end

  subgraph Disk Persistence
    D1[data/<doc>.bin\n- Encoded Y.Update snapshot\n- Reloaded on startup]
  end

  A1 <--> |Yjs sync + awareness messages| C2
  B1 <--> |Yjs sync + awareness messages| C2
  C1 --> |calls setupWSConnection| C2
  C2 --> |broadcast updates| A1
  C2 --> |broadcast updates| B1
  C2 --> |write encoded state| D1
  D1 --> |replay on boot| C2
```

## Interaction Walkthrough
1. **Browser or robot clients** bootstrap a `Y.Doc`, attach the `WebsocketProvider`, and populate awareness metadata (display name, color, cursor/identity).【F:client/src/App.js†L1-L210】【F:robots/src/robot-a.ts†L1-L123】
2. **`server/src/index.ts`** upgrades HTTP requests to WebSocket connections and delegates each socket to `setupWSConnection`, tying all peers to the shared document namespace.【F:server/src/index.ts†L1-L27】
3. **`server/src/yjs-ws-server.ts`** owns the authoritative `WSSharedDoc`, handles sync/auth/awareness messages, broadcasts updates to connected peers, and persists the CRDT state to `data/<doc>.bin` for crash recovery.【F:server/src/yjs-ws-server.ts†L1-L208】
4. **Persistence** reloads on startup so the server can recover the Y.Doc state; subsequent updates trigger snapshot writes ensuring deterministic convergence after restarts.【F:server/src/yjs-ws-server.ts†L18-L114】
5. **Undo/redo isolation** is achieved because each client tags transactions with its stable ID and tracks only its own origin via `Y.UndoManager`, allowing deterministic merges across human and robot editors.【F:client/src/App.js†L41-L210】【F:robots/src/robot-a.ts†L40-L106】

This architecture ensures all actors share the same `shared-doc` while maintaining per-client identity, deterministic CRDT reconciliation, and resilience via on-disk persistence.
