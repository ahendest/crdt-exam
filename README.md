# CRDT Collab

## Project Goal
A shared text/whiteboard playground where browser clients and scripted "robots" all edit the same document concurrently using the Yjs CRDT. Design requirements include deterministic merges, per-client undo stacks, recovery from crashes or reconnects, and automated robots that stress-test conflicting edits plus offline/online scenarios.

## Architecture At A Glance
```
Browser Clients (React)     Robot Clients (Node)
        \                        /
         \                      /
          v                    v
        Yjs WebSocket Sync Server (Node + ws)
                  |
             (future) Persistence Layer
```
- The server exposes a single WebSocket endpoint (http upgrade on port 1234) and multiplexes all peers onto the `shared-doc` Y.Doc.
- Awareness messages keep cursors/presence in sync; each peer later gets a UUID used as the `origin` for transactions so UndoManager can isolate per-client undo/redo stacks.
- Persistence will snapshot updates so reconnecting clients, robots, or a restarted server all converge to the same text.

## Repository Layout
```
crdt-collab/
  package.json          Workspace root (manages server, client, robots)
  server/               Node WebSocket sync server (TypeScript)
  robots/               Headless Node clients that simulate edits
  client/               React UI (placeholder for now)
```

## Current Capabilities
- TypeScript tooling bootstrapped for `server/` and `robots/` (tsc, ts-node-dev, strict mode).
- WebSocket sync server online with manual Yjs doc registry and awareness handling (`server/src/index.ts`, `server/src/yjs-ws-server.ts`).
- Robot scaffolding in place (will connect as headless editors in later steps).
- React browser client connects to the shared `Y.Text`, shows live presence, and exposes per-client undo/redo so humans can collaborate alongside the robots.

## Development Setup
1. **Prerequisites**: Node.js LTS (>=18 recommended) and npm.
2. **Install dependencies** (runs once from repo root):
   ```bash
   npm install
   ```
3. **Environment variables**: optional `PORT` for the server; defaults to `1234`.

### Running the Sync Server
```bash
npm run dev --prefix server
```
- Serves http health check at `http://localhost:1234/`.
- WebSocket clients connect via `ws://localhost:1234` and automatically join `shared-doc`.
- Use `npm run build --prefix server` then `npm run start --prefix server` for production builds.

### Robot Clients
Development stubs live in `robots/src`. Example watch command while building Robot A:
```bash
npm run dev:a --prefix robots
```
Robot A now connects to the shared doc, writes a greeting, randomly performs a per-client undo, and disconnects. To point it at a remote server set `WS_ENDPOINT=ws://host:port`.
Later we will add Robot B and coordinated scenario scripts that:
- Connect/disconnect to simulate flaky networks.
- Perform per-client undo (`UndoManager` with `trackedOrigins`).
- Assert deterministic convergence after conflict heavy sequences.

### Browser Client
```bash
npm start --prefix client
```
- Default WebSocket endpoint: `ws://localhost:1234`. Override via `REACT_APP_WS_ENDPOINT=ws://your-host:port npm start --prefix client`.
- Features: collaborative textarea bound to `shared-doc`, per-client identity with editable display names, undo/redo buttons scoped to the local origin, and a presence list showing all peers (browser tabs + robots).

## Per-Client Identity & Undo (Design)
- Each peer (browser tab or robot) generates a stable UUID and stores it (localStorage for browsers, file/env for robots).
- All mutations run within `doc.transact(fn, clientId)` so Yjs tags updates with the origin.
- `UndoManager` instances track only this origin: `new UndoManager(yText, { trackedOrigins: [clientId] })`.
- Undo buttons or robot scripts call `undo()` / `redo()` without touching other clients.

## Offline / Reconnect Strategy
- Clients stay connected through `y-websocket`; when offline, updates buffer locally.
- Upon reconnect, Yjs exchanges any missing updates; deterministic CRDT merge ensures identical docs regardless of delivery order.
- Persistence layer (Step 4) will replay stored updates to rebuild the Y.Doc after a server restart, completing the "tab crash + refresh" resilience story.

## Roadmap
1. **Persistence adapter**: save/load Y.Doc updates so state survives server restarts.
2. **React editor**: render collaborative textarea/whiteboard bound to the shared `Y.Text`.
3. **Client identity plumbing**: stable IDs + awareness metadata (name, color, cursor).
4. **Per-client UndoManager**: UI buttons + keyboard shortcuts; robots call it programmatically.
5. **Offline/reconnect verification**: manual testing plus scripts to ensure deterministic merges.
6. **Robot scenarios**:
   - Robot A/B basic editing.
   - Conflict/undo/offline sequences with assertions that final text matches expected.
7. **Automated convergence tests**: run repeatable scripts comparing docs across peers.
8. **Architecture diagram & write-up**: final documentation deliverable for the assignment.

## Troubleshooting
- `Cannot find module 'ws'` or `@types/ws`: ensure `npm install` ran in the root workspace so dependencies are hoisted.
- `Package subpath './server' is not defined by "exports" in y-websocket`: we ship a local `yjs-ws-server.ts` helper and no longer import internal y-websocket paths.
- Port conflicts on 1234: export `PORT=5678` (PowerShell `setx PORT 5678`) and restart the server.
- Server persistence snapshots live in `server/data/`. Delete the corresponding `.bin` file if you want to reset the shared document.

## Contributing Notes
- Keep code strictly typed; use `doc.transact` wrappers and add succinct comments only when logic is non-obvious.
- Tests/scripts that simulate robot behaviour should be deterministic and idempotent.
- When adding persistence, consider LevelDB, SQLite, or filesystem snapshots; persistence must integrate with the `WSSharedDoc` lifecycle.
