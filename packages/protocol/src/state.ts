import type { TodoItem, ToolCategory } from "./events.js";

/** What the agent is doing right now — the client maps this to a place in the office. */
export type Activity =
  | "thinking"
  | "edit"
  | "read"
  | "shell"
  /** Running tests: a shell call that looks like a test run (see isTestRun). */
  | "test"
  /** Git work: commit, push, PRs (see isGitCommand). */
  | "git"
  | "web"
  | "mcp"
  | "delegate"
  | "message"
  | "other"
  | "waiting"
  /** Nothing to do but wait for its background commands (builds, test runs) to finish. */
  | "background"
  | "compact"
  | "idle"
  | "ended";

export type AgentStatus = "working" | "waiting" | "idle" | "ended";

/** A command running in the background (see the `job.start` event). */
export interface Job {
  callId: string;
  /** The command, summarized like a tool call ("Bash: pnpm test"). */
  summary: string;
  /** What it's for ("Run the test suite"), when the agent said. */
  label?: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
}

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
  /** The person whose agent this is (from their ingest token). */
  user?: string;
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
  /** The last turn-level error (rate limit, overloaded, …). */
  lastError?: { text: string; at: number };
  /** When a test run last passed — the office celebrates. */
  lastWinAt?: number;
  /** Context window use. */
  context?: { tokens: number; limit: number; at: number };
  /** Git branch of the session's folder. */
  branch?: string;
  /** The agent's todo list, in its own order. */
  todos?: TodoItem[];
  /** Background commands: the running ones, and the last few that finished (newest last). */
  jobs?: Job[];
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
/** Finished background jobs kept on an agent (running ones are always kept). */
export const RECENT_JOBS = 5;
/**
 * A background job we never heard the end of (the session was killed, the
 * hook didn't run) stops counting as running after this long.
 */
export const JOB_GIVE_UP_MS = 6 * 60 * 60_000;
/** Ended agents are dropped from the state this long after they ended. */
export const ENDED_RETENTION_MS = 60_000;

export function emptyState(): OfficeState {
  return { agents: {}, version: 0, now: 0 };
}
