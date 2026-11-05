import type { ToolCategory } from "./events.js";

/** What the agent is doing right now — the client maps this to a place in the office. */
export type Activity =
  | "thinking"
  | "edit"
  | "read"
  | "shell"
  | "web"
  | "mcp"
  | "delegate"
  | "message"
  | "other"
  | "waiting"
  | "compact"
  | "idle"
  | "ended";

export type AgentStatus = "working" | "waiting" | "idle" | "ended";

export interface ToolCall {
  callId: string;
  tool: string;
  category: ToolCategory;
  summary: string;
  detail?: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
}

/**
 * Something an agent says out loud. The client shows a speech bubble whenever
 * `at` changes. `kind` picks the scene (a delegation, a report back, …).
 */
export interface Utterance {
  kind: "prompt" | "delegate" | "report" | "message" | "question" | "permission";
  text: string;
  at: number;
  /** The other party, when there is one. */
  withAgentId?: string;
}

export interface AgentState {
  id: string;
  source: string;
  sessionId: string;
  parentId?: string;
  /** Generated human first name, stable per agent id. */
  name: string;
  label?: string;
  project: { path: string; name: string };
  status: AgentStatus;
  activity: Activity;
  activitySince: number;
  /** Tool calls that have started and not ended, newest last. */
  openCalls: ToolCall[];
  /** Last N finished and running calls, newest last. */
  recentTools: ToolCall[];
  prompt?: string;
  /** Sub-agents: the short task their parent gave them ("find usages of useAuth"). */
  task?: string;
  /** Sub-agents: the full brief their parent wrote. */
  taskBrief?: string;
  waiting?: { reason: "permission" | "question"; text?: string; since: number };
  lastSaid?: Utterance;
  lastErrorAt?: number;
  /** Delegations this agent started (tool call ids) that haven't been matched to a child yet. */
  pendingDelegations: string[];
  startedAt: number;
  lastEventAt: number;
  endedAt?: number;
  endedOk?: boolean;
}

export interface OfficeState {
  agents: Record<string, AgentState>;
  /** Increments on every applied event. */
  version: number;
  /** Timestamp of the newest event applied. */
  now: number;
}

export const RECENT_TOOLS = 20;
/** Ended agents are dropped from the state this long after they ended. */
export const ENDED_RETENTION_MS = 60_000;

export function emptyState(): OfficeState {
  return { agents: {}, version: 0, now: 0 };
}
