import type { IncomingMessage } from "http";
import WebSocket, { RawData } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as authProtocol from "y-protocols/auth";
import { createMutex, type mutex } from "lib0/mutex";

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;
const messageQueryAwareness = 3;

const permissionDeniedHandler: authProtocol.PermissionDeniedHandler = (
  _ydoc,
  reason
) => {
  console.warn("Permission denied when reading auth message", reason);
};

type AwarenessUpdate = {
  added: number[];
  updated: number[];
  removed: number[];
};

export interface SetupWSConnectionOptions {
  docName?: string;
  gc?: boolean;
}

class WSSharedDoc extends Y.Doc {
  public readonly name: string;
  public readonly awareness: awarenessProtocol.Awareness;
  public readonly mux: mutex;
  public readonly conns: Map<WebSocket, Set<number>>;

  constructor(name: string) {
    super();
    this.name = name;
    this.mux = createMutex();
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
  }
}

const docs = new Map<string, WSSharedDoc>();

const send = (conn: WebSocket, message: Uint8Array): void => {
  if (conn.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    conn.send(message);
  } catch (error) {
    console.error("Failed to send message to WebSocket client", error);
  }
};

const broadcastAwareness = (
  doc: WSSharedDoc,
  changedClients: number[],
  origin: WebSocket | null
): void => {
  if (changedClients.length === 0) {
    return;
  }
  const awarenessMessage = encoding.createEncoder();
  encoding.writeVarUint(awarenessMessage, messageAwareness);
  encoding.writeVarUint8Array(
    awarenessMessage,
    awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients)
  );
  const message = encoding.toUint8Array(awarenessMessage);
  doc.conns.forEach((_trackedClients, conn) => {
    if (conn !== origin) {
      send(conn, message);
    }
  });
};

const setupDoc = (docName: string, gc = true): WSSharedDoc => {
  let doc = docs.get(docName);
  if (doc) {
    doc.gc = gc;
    return doc;
  }

  doc = new WSSharedDoc(docName);
  doc.gc = gc;
  docs.set(docName, doc);

  doc.on("update", (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    doc?.conns.forEach((_trackedClients, conn) => {
      if (conn !== origin) {
        send(conn, message);
      }
    });
  });

  doc.awareness.on(
    "update",
    ({ added, updated, removed }: AwarenessUpdate, origin: unknown) => {
      const changedClients = added.concat(updated, removed);
      broadcastAwareness(doc!, changedClients, origin as WebSocket | null);
    }
  );

  doc.on("destroy", () => {
    docs.delete(docName);
  });

  return doc;
};

const readMessage = (message: RawData): Uint8Array => {
  if (Buffer.isBuffer(message)) {
    return new Uint8Array(
      message.buffer,
      message.byteOffset,
      message.byteLength
    );
  }
  if (Array.isArray(message)) {
    return readMessage(Buffer.concat(message));
  }
  if (typeof message === "string") {
    return new Uint8Array(Buffer.from(message));
  }
  return new Uint8Array(message);
};

const sendSyncStep1 = (conn: WebSocket, doc: WSSharedDoc): void => {
  doc.mux(() => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(conn, encoding.toUint8Array(encoder));
  });
};

const sendAwarenessSnapshot = (conn: WebSocket, doc: WSSharedDoc): void => {
  const awarenessStates = doc.awareness.getStates();
  const clients = Array.from(awarenessStates.keys());
  if (clients.length === 0) {
    return;
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(doc.awareness, clients)
  );
  send(conn, encoding.toUint8Array(encoder));
};

const removeConnection = (doc: WSSharedDoc, conn: WebSocket): void => {
  const trackedClients = doc.conns.get(conn);
  doc.conns.delete(conn);
  if (!trackedClients || trackedClients.size === 0) {
    return;
  }
  awarenessProtocol.removeAwarenessStates(
    doc.awareness,
    Array.from(trackedClients),
    conn
  );
};

export const setupWSConnection = (
  conn: WebSocket,
  req: IncomingMessage,
  opts: SetupWSConnectionOptions = {}
): void => {
  const docName = opts.docName ?? req.url?.slice(1) ?? "default";
  const doc = setupDoc(docName, opts.gc ?? true);
  doc.conns.set(conn, new Set());

  const awarenessListener = (
    { added, updated, removed }: AwarenessUpdate,
    origin: unknown
  ) => {
    if (origin !== conn) {
      return;
    }
    const tracked = doc.conns.get(conn);
    if (!tracked) {
      return;
    }
    added.forEach((clientId) => tracked.add(clientId));
    updated.forEach((clientId) => tracked.add(clientId));
    removed.forEach((clientId) => tracked.delete(clientId));
  };

  doc.awareness.on("update", awarenessListener);

  const messageHandler = (rawMessage: RawData): void => {
    const data = readMessage(rawMessage);
    doc.mux(() => {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          const reply = encoding.toUint8Array(encoder);
          if (reply.length > 1) {
            send(conn, reply);
          }
          break;
        }
        case messageQueryAwareness: {
          sendAwarenessSnapshot(conn, doc);
          break;
        }
        case messageAwareness: {
          const awarenessUpdate = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            awarenessUpdate,
            conn
          );
          break;
        }
        case messageAuth: {
          authProtocol.readAuthMessage(
            decoder,
            doc,
            permissionDeniedHandler
          );
          break;
        }
        default:
          console.warn("Received unknown message type", messageType);
          break;
      }
    });
  };

  conn.on("message", messageHandler);

  const closeHandler = (): void => {
    doc.awareness.off("update", awarenessListener);
    removeConnection(doc, conn);
  };

  conn.on("close", closeHandler);
  conn.on("error", closeHandler);

  sendSyncStep1(conn, doc);
  sendAwarenessSnapshot(conn, doc);
};
