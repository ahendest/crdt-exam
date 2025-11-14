import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const DOC_NAME = process.env.DOC_NAME ?? "shared-doc";
const SERVER_ENDPOINT =
  process.env.WS_ENDPOINT ??
  process.env.WSS_ENDPOINT ??
  process.env.SERVER_ENDPOINT ??
  "ws://localhost:1234";
const ROBOT_NAME = process.env.ROBOT_NAME ?? "Robot-A";
const STORAGE_FILE = path.resolve(
  __dirname,
  `../.${ROBOT_NAME.replace(/\s+/g, "-").toLowerCase()}-id`
);

const loadClientId = (): string => {
  try {
    const value = fs.readFileSync(STORAGE_FILE, "utf8").trim();
    if (value) {
      return value;
    }
  } catch {
    // file missing, we generate a new id below
  }
  const fresh = randomUUID();
  fs.writeFileSync(STORAGE_FILE, fresh, "utf8");
  return fresh;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const clientId = loadClientId();
const log = (message: string) => {
  console.log(`[${ROBOT_NAME}] ${message}`);
};

const runScenario = async (): Promise<void> => {
  log(
    `connecting to ${SERVER_ENDPOINT} / doc "${DOC_NAME}" with clientId ${clientId}`
  );

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(SERVER_ENDPOINT, DOC_NAME, doc, {
    connect: true
  });
  const yText = doc.getText("shared-text");
  const undoManager = new Y.UndoManager(yText, {
    trackedOrigins: new Set([clientId])
  });

  provider.awareness.setLocalState({
    user: {
      id: clientId,
      name: ROBOT_NAME,
      color: "#1d4ed8"
    }
  });

  provider.on("status", (event: { status: string }) => {
    log(`status -> ${event.status}`);
  });

  provider.on("connection-error", (event: unknown) => {
    log(`connection error ${(event as Error)?.message ?? event}`);
  });

  provider.on("connection-close", () => {
    log("connection closed");
  });

  const performActions = async () => {
    const timestamp = new Date().toISOString();
    const baseMessage = `[${timestamp}] ${ROBOT_NAME} says hello!`;

    log("inserting greeting");
    doc.transact(() => {
      const insertAt = yText.length;
      const text = (insertAt === 0 ? "" : "\n") + baseMessage;
      yText.insert(insertAt, text);
    }, clientId);

    await sleep(1200);

    if (Math.random() < 0.5) {
      log("undoing greeting to mimic per-client undo");
      undoManager.undo();
    } else {
      log("adding a follow-up line");
      doc.transact(() => {
        yText.insert(
          yText.length,
          ` (follow-up ${Math.random().toFixed(3)})`
        );
      }, clientId);
    }

    await sleep(800);
    log("scenario complete, destroying provider");
    provider.destroy();
    doc.destroy();
    process.exit(0);
  };

  provider.once("status", async (event: { status: string }) => {
    if (event.status === "connected") {
      await performActions();
    }
  });
};

runScenario().catch((error) => {
  console.error(`[${ROBOT_NAME}] fatal error`, error);
  process.exit(1);
});
