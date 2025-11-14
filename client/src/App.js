import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import "./App.css";

const DOC_NAME = "shared-doc";
const WS_ENDPOINT =
  process.env.REACT_APP_WS_ENDPOINT ||
  process.env.REACT_APP_SERVER_URL ||
  "ws://localhost:1234";
const CLIENT_ID_KEY = "crdt-collab/client-id";
const CLIENT_NAME_KEY = "crdt-collab/display-name";
const COLORS = [
  "#ef476f",
  "#ffd166",
  "#06d6a0",
  "#118ab2",
  "#8338ec",
  "#ffb5a7",
  "#06aed5",
  "#ff6b6b"
];

const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const loadFromStorage = (key, fallback) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  return stored ?? fallback;
};

const storeValue = (key, value) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value);
};

const App = () => {
  const [clientId] = useState(() => {
    const existing = loadFromStorage(CLIENT_ID_KEY, "");
    if (existing) {
      return existing;
    }
    const fresh = generateId();
    storeValue(CLIENT_ID_KEY, fresh);
    return fresh;
  });

  const color = useMemo(() => {
    const code = clientId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return COLORS[code % COLORS.length];
  }, [clientId]);

  const defaultName = useMemo(
    () => loadFromStorage(CLIENT_NAME_KEY, `User ${clientId.slice(-4)}`),
    [clientId]
  );
  const [displayName, setDisplayName] = useState(defaultName);
  const [textValue, setTextValue] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const docRef = useRef(null);
  const yTextRef = useRef(null);
  const providerRef = useRef(null);
  const awarenessRef = useRef(null);
  const undoManagerRef = useRef(null);

  useEffect(() => {
    if (displayName) {
      storeValue(CLIENT_NAME_KEY, displayName);
    }
  }, [displayName]);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_ENDPOINT, DOC_NAME, doc);
    const awareness = provider.awareness;
    const yText = doc.getText("shared-text");
    const undoManager = new Y.UndoManager(yText, {
      trackedOrigins: new Set([clientId])
    });

    docRef.current = doc;
    yTextRef.current = yText;
    providerRef.current = provider;
    awarenessRef.current = awareness;
    undoManagerRef.current = undoManager;

    const handleAwarenessChange = () => {
      const entries = [];
      awareness.getStates().forEach((state) => {
        if (state && state.user) {
          entries.push(state.user);
        }
      });
      entries.sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setPeers(entries);
    };

    const handleTextUpdate = () => {
      setTextValue(yText.toString());
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    const handleStatus = ({ status }) => {
      setConnectionStatus(status);
    };

    const handleStackChange = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    yText.observe(handleTextUpdate);
    handleTextUpdate();
    awareness.on("change", handleAwarenessChange);
    handleAwarenessChange();
    provider.on("status", handleStatus);
    undoManager.on("stack-item-added", handleStackChange);
    undoManager.on("stack-item-popped", handleStackChange);

    return () => {
      yText.unobserve(handleTextUpdate);
      awareness.off("change", handleAwarenessChange);
      provider.off("status", handleStatus);
      undoManager.off("stack-item-added", handleStackChange);
      undoManager.off("stack-item-popped", handleStackChange);
      undoManager.clear();
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      yTextRef.current = null;
      providerRef.current = null;
      awarenessRef.current = null;
      undoManagerRef.current = null;
    };
  }, [clientId]);

  useEffect(() => {
    const awareness = awarenessRef.current;
    if (awareness) {
      awareness.setLocalStateField("user", {
        id: clientId,
        name: displayName,
        color
      });
    }
  }, [clientId, color, displayName]);

  const applyTextChange = useCallback(
    (event) => {
      const yText = yTextRef.current;
      const doc = docRef.current;
      if (!yText || !doc) {
        setTextValue(event.target.value);
        return;
      }
      const newValue = event.target.value;
      const currentValue = yText.toString();
      if (newValue === currentValue) {
        return;
      }
      let start = 0;
      const minLen = Math.min(currentValue.length, newValue.length);
      while (start < minLen && currentValue[start] === newValue[start]) {
        start += 1;
      }
      let oldEnd = currentValue.length;
      let newEnd = newValue.length;
      while (
        oldEnd > start &&
        newEnd > start &&
        currentValue[oldEnd - 1] === newValue[newEnd - 1]
      ) {
        oldEnd -= 1;
        newEnd -= 1;
      }
      const deleteLen = oldEnd - start;
      const insertText = newValue.slice(start, newEnd);
      doc.transact(() => {
        if (deleteLen > 0) {
          yText.delete(start, deleteLen);
        }
        if (insertText.length > 0) {
          yText.insert(start, insertText);
        }
      }, clientId);
    },
    [clientId]
  );

  const handleUndo = useCallback(() => {
    undoManagerRef.current?.undo();
    setCanUndo(undoManagerRef.current?.canUndo() ?? false);
    setCanRedo(undoManagerRef.current?.canRedo() ?? false);
  }, []);

  const handleRedo = useCallback(() => {
    undoManagerRef.current?.redo();
    setCanUndo(undoManagerRef.current?.canUndo() ?? false);
    setCanRedo(undoManagerRef.current?.canRedo() ?? false);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>CRDT Collab Playground</h1>
          <p>
            Connected to <code>{DOC_NAME}</code> over{" "}
            <code>{new URL(WS_ENDPOINT).origin}</code>
          </p>
        </div>
        <div className={`status-badge status-${connectionStatus}`}>
          {connectionStatus}
        </div>
      </header>

      <section className="identity-panel">
        <label className="field">
          <span>Your name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Enter a display name"
          />
        </label>
        <div className="identity-chip">
          <span
            className="color-dot"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <div>
            <div>{displayName || "Anonymous"}</div>
            <small>{clientId}</small>
          </div>
        </div>
      </section>

      <section className="editor-panel">
        <div className="editor-toolbar">
          <button onClick={handleUndo} disabled={!canUndo}>
            Undo
          </button>
          <button onClick={handleRedo} disabled={!canRedo}>
            Redo
          </button>
          <span className="hint">Per-client undo/redo tracks only your edits.</span>
        </div>
        <textarea
          spellCheck={false}
          value={textValue}
          onChange={applyTextChange}
          placeholder="Start typing to collaborate..."
        />
      </section>

      <section className="presence-panel">
        <h2>Connected peers</h2>
        <ul>
          {peers.map((peer) => (
            <li key={peer.id}>
              <span
                className="color-dot"
                style={{ backgroundColor: peer.color }}
              />
              <div>
                <div>
                  {peer.name || "Anonymous"}{" "}
                  {peer.id === clientId && <em>(you)</em>}
                </div>
                <small>{peer.id}</small>
              </div>
            </li>
          ))}
          {peers.length === 0 && <li>No active peers yet.</li>}
        </ul>
      </section>
    </div>
  );
};

export default App;
