import { emptyState, reduce, type AgentEvent, type OfficeState, type ServerMessage } from "@pixel-office/protocol";

export type ConnectionStatus = "connecting" | "live" | "offline";

type Listener = (state: OfficeState, event?: AgentEvent) => void;

/**
 * Keeps a local copy of the office state in sync with the server: a snapshot
 * on connect, then events run through the same reducer the server uses.
 */
export class OfficeStore {
  state: OfficeState = emptyState();
  status: ConnectionStatus = "connecting";
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private ws: WebSocket | undefined;
  private retry = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: ConnectionStatus) => void): void {
    this.statusListeners.add(fn);
    fn(this.status);
  }

  /** Feed messages directly (used by the offline demo and tests). */
  receive(msg: ServerMessage): void {
    if (msg.t === "snapshot") {
      this.state = msg.state;
      this.emit();
    } else {
      this.state = reduce(this.state, msg.e);
      this.emit(msg.e);
    }
  }

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("live");
    };
    ws.onmessage = (m) => {
      try {
        this.receive(JSON.parse(m.data as string) as ServerMessage);
      } catch (err) {
        console.warn("[pixel-office] bad message", err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus("offline");
      void this.checkAuth().then((ok) => {
        if (!ok) return;
        const delay = Math.min(15_000, 500 * 2 ** this.retry++);
        setTimeout(() => this.connect(), delay);
      });
    };
  }

  /** A closed socket might mean the login expired — send the user to log in again. */
  private async checkAuth(): Promise<boolean> {
    try {
      const res = await fetch("/api/state", { credentials: "same-origin" });
      if (res.status === 401) {
        location.href = "/login";
        return false;
      }
    } catch {
      // Server down — keep retrying.
    }
    return true;
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private emit(e?: AgentEvent) {
    for (const fn of this.listeners) fn(this.state, e);
  }
}
