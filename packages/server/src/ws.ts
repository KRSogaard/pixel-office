import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerMessage } from "@pixel-office/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { SESSION_COOKIE, isAuthed } from "./http.js";
import type { Hub } from "./hub.js";
import type { Secrets } from "./secrets.js";
import type { SettingsStore } from "./settings.js";
import type { StatsTracker } from "./stats.js";
import type { UsersStore } from "./users.js";

const SNAPSHOT_EVERY_MS = 30_000;
const PING_EVERY_MS = 25_000;
/** Stats go out at most this often, and only when they changed. */
const STATS_EVERY_MS = 5000;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Same-origin check: blocks other websites from opening a socket with the user's cookie. */
export function originMatches(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocket(
  server: Server,
  hub: Hub,
  secrets: Secrets,
  settings: SettingsStore,
  stats?: StatsTracker,
  users?: UsersStore,
): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/ws") return reject(socket, 404, "Not Found");
    if (!originMatches(req.headers.origin, req.headers.host)) return reject(socket, 403, "Forbidden");
    if (!isAuthed(secrets, readCookie(req.headers.cookie, SESSION_COOKIE), Date.now(), users)) return reject(socket, 401, "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", () => {}); // clients don't send anything meaningful
    send(ws, { t: "snapshot", state: hub.snapshot });
    send(ws, { t: "settings", settings: settings.get() });
    if (stats) send(ws, { t: "stats", stats: stats.get() });
  });

  let statsSent = stats?.changes ?? 0;
  const statsTimer = setInterval(() => {
    if (!stats || stats.changes === statsSent) return;
    statsSent = stats.changes;
    const msg = JSON.stringify({ t: "stats", stats: stats.get() } satisfies ServerMessage);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  }, STATS_EVERY_MS);
  statsTimer.unref();

  const unsubscribeSettings = settings.subscribe((s) => {
    for (const ws of wss.clients) send(ws, { t: "settings", settings: s });
  });

  const unsubscribe = hub.subscribe((e) => {
    const msg = JSON.stringify({ t: "event", e } satisfies ServerMessage);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  });

  const snapshotTimer = setInterval(() => {
    for (const ws of wss.clients) send(ws, { t: "snapshot", state: hub.snapshot });
  }, SNAPSHOT_EVERY_MS);
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_EVERY_MS);
  snapshotTimer.unref();
  pingTimer.unref();

  return () => {
    unsubscribe();
    unsubscribeSettings();
    clearInterval(snapshotTimer);
    clearInterval(statsTimer);
    clearInterval(pingTimer);
    wss.close();
  };
}
