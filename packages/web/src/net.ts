import {
  DEFAULT_SETTINGS,
  emptyState,
  reduce,
  type AgentEvent,
  type OfficeSettings,
  type OfficeState,
  type ServerMessage,
} from "@pixel-office/protocol";

export type ConnectionStatus = "connecting" | "live" | "offline";
export type StoreMode = "live" | "replay";

type Listener = (state: OfficeState, event?: AgentEvent) => void;

/**
 * Keeps a local copy of the office state in sync with the server: a snapshot
 * on connect, then events run through the same reducer the server uses.
 *
 * In replay mode the office shows a past state chosen by the replay controller,
 * while the live state keeps updating in the background for when you return.
 */
export class OfficeStore {
  state: OfficeState = emptyState();
  settings: OfficeSettings = DEFAULT_SETTINGS;
  status: ConnectionStatus = "connecting";
  mode: StoreMode = "live";
  private live: OfficeState = emptyState();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private settingsListeners = new Set<(s: OfficeSettings) => void>();
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

  onSettings(fn: (s: OfficeSettings) => void): void {
    this.settingsListeners.add(fn);
    fn(this.settings);
  }

  /** Feed a server message (also used by tests). */
  receive(msg: ServerMessage): void {
    if (msg.t === "settings") {
      this.settings = msg.settings;
      for (const fn of this.settingsListeners) fn(msg.settings);
      return;
    }
    if (msg.t === "snapshot") this.live = msg.state;
    else this.live = reduce(this.live, msg.e);
    if (this.mode !== "live") return;
    this.state = this.live;
    this.emit(msg.t === "event" ? msg.e : undefined);
  }

  /** Show a past state (replay). The caller resets the scene around jumps. */
  showPast(state: OfficeState, event?: AgentEvent): void {
    this.mode = "replay";
    this.state = state;
    this.emit(event);
  }

  backToLive(): void {
    this.mode = "live";
    this.state = this.live;
    this.emit();
  }

  /** Save shared office settings on the server; every browser gets them back over the socket. */
  async saveSettings(settings: OfficeSettings): Promise<void> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-po-csrf": "1" },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`saving settings failed: ${res.status}`);
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
