import { z } from "zod";

/**
 * The one event shape every agent tool is translated into.
 * Adapters (server side) produce these; the reducer consumes them.
 */

export const TOOL_CATEGORIES = ["edit", "read", "shell", "web", "mcp", "delegate", "message", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Text fields are clipped to this length before they enter the state. */
export const MAX_TEXT = 280;

const text = z.string().transform((s) => clip(s, MAX_TEXT));
const id = z.string().min(1).max(200);

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

const todoItem = z.object({
  id: z.string().max(200).optional(),
  text: z.string().transform((s) => clip(s, 160)),
  status: z.enum(TODO_STATUSES),
});
export type TodoItem = z.output<typeof todoItem>;

/** Assumed context window when the source doesn't say. */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

const base = {
  source: z.string().min(1).max(40),
  agentId: id,
  /** The session this agent belongs to. For sub-agents it's the parent's session. */
  sessionId: id,
  parentAgentId: id.optional(),
  /** Free-form label such as a sub-agent type ("Explore") or teammate name. */
  label: z.string().max(80).optional(),
  project: z.object({ path: z.string().max(500), name: z.string().max(120) }),
  ts: z.number().int().nonnegative(),
};

export const agentEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("session.start") }),
  z.object({
    ...base,
    kind: z.literal("session.end"),
    ok: z.boolean().optional(),
    /** What a sub-agent hands back to its parent when it finishes. */
    report: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("prompt"), text }),
  /** The agent is working but hasn't picked a tool yet (thinking / streaming a reply). */
  z.object({ ...base, kind: z.literal("busy") }),
  z.object({
    ...base,
    kind: z.literal("tool.start"),
    callId: id,
    tool: z.string().min(1).max(120),
    category: z.enum(TOOL_CATEGORIES),
    summary: text.optional(),
    /** Longer context for the call. For a delegation: the brief handed to the sub-agent. */
    detail: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("tool.end"), callId: id, ok: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("waiting"),
    reason: z.enum(["permission", "question"]),
    text: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("idle") }),
  z.object({ ...base, kind: z.literal("compact") }),
  z.object({ ...base, kind: z.literal("error"), text: text.optional() }),
  z.object({
    ...base,
    kind: z.literal("message"),
    /** Recipient: an agentId, or a label/name the reducer resolves within the same session. */
    to: z.string().min(1).max(200),
    text,
  }),
  /** How full the agent's context window is. */
  z.object({
    ...base,
    kind: z.literal("context"),
    tokens: z.number().int().nonnegative(),
    /** Window size; defaults to DEFAULT_CONTEXT_LIMIT (or 1M once tokens exceed it). */
    limit: z.number().int().positive().optional(),
  }),
  /** The git branch the agent's session is on. */
  z.object({ ...base, kind: z.literal("branch"), branch: z.string().min(1).max(120) }),
  /** The agent's whole todo list (Claude TodoWrite, OpenCode todo.updated). */
  z.object({ ...base, kind: z.literal("todos"), items: z.array(todoItem).max(100) }),
  /** One todo added or changed (Claude TaskCreated / TaskCompleted). */
  z.object({ ...base, kind: z.literal("todo"), item: todoItem }),
]);

export type AgentEvent = z.output<typeof agentEventSchema>;
export type AgentEventKind = AgentEvent["kind"];
export type AgentEventInput = z.input<typeof agentEventSchema>;

export function clip(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function projectFromPath(path: string | undefined): { path: string; name: string } {
  const p = (path ?? "").replace(/[\\/]+$/, "");
  const name = p.split(/[\\/]/).pop() || "unknown";
  return { path: p || "unknown", name };
}

/** Shared office settings, edited in the browser and stored on the server. */
export type TopRoom = "library" | "server" | "lab" | "git" | "mail";
export interface OfficeSettings {
  /** Left-to-right order of the rooms along the top. */
  roomOrder: TopRoom[];
  /** Smallest size of each room, in agents it fits. */
  minRooms: {
    library: number;
    server: number;
    lab: number;
    git: number;
    mail: number;
    lounge: number;
    reception: number;
    globe: number;
    filing: number;
  };
  /** Team areas side by side (1–4). */
  teamsPerRow: number;
  rugs: boolean;
  plants: boolean;
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  roomOrder: ["library", "server", "lab", "git", "mail"],
  minRooms: { library: 4, server: 4, lab: 3, git: 3, mail: 3, lounge: 6, reception: 4, globe: 2, filing: 3 },
  teamsPerRow: 3,
  rugs: true,
  plants: true,
};

/** Messages the server sends to browsers over the WebSocket. */
export type ServerMessage =
  | { t: "snapshot"; state: import("./state.js").OfficeState }
  | { t: "event"; e: AgentEvent }
  | { t: "settings"; settings: OfficeSettings };
