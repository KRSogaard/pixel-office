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
  /**
   * The person whose agent this is. Set by the server from the ingest token
   * (anything a client sends here is overwritten), absent for the shared token.
   */
  user: z.string().max(40).optional(),
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
    /** The tool call this is about, when the source knows it. */
    callId: id.optional(),
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
  /**
   * A command the agent started in the background (a build, a test run…): it
   * keeps running after the tool call returns, while the agent waits or does
   * other work. `callId` is the tool call that started it.
   */
  z.object({
    ...base,
    kind: z.literal("job.start"),
    callId: id,
    /** The command, summarized like a tool call ("Bash: pnpm test"). */
    summary: text,
    /** What it's for, in a few words ("Run the test suite"), when the agent said. */
    label: text.optional(),
  }),
  /** A background command finished (`ok`: it succeeded; false: it failed or was stopped). */
  z.object({ ...base, kind: z.literal("job.end"), callId: id, ok: z.boolean() }),
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
export type TopRoom = "web" | "server" | "cafe" | "lab" | "git" | "meeting";
export interface OfficeSettings {
  /** Left-to-right order of the rooms along the top. */
  roomOrder: TopRoom[];
  /** Smallest size of each room, in agents it fits (`web`: the internet room's laptops; `lounge`: the café's sofas; `meeting`: chairs for agents waiting on you). */
  minRooms: {
    web: number;
    server: number;
    lab: number;
    git: number;
    meeting: number;
    lounge: number;
  };
  /** Team areas side by side (1–4). */
  teamsPerRow: number;
  rugs: boolean;
  plants: boolean;
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  // The meeting room (with the statue of the Almighty Prompter) first, where it's easy to see.
  roomOrder: ["meeting", "server", "lab", "cafe", "web", "git"],
  minRooms: { web: 4, server: 4, lab: 3, git: 3, meeting: 4, lounge: 6 },
  teamsPerRow: 3,
  rugs: true,
  plants: true,
};

/** Counters behind the production board. */
export interface StatCounters {
  launches: number;
  commits: number;
  testRuns: number;
  testPasses: number;
  edits: number;
  failures: number;
  prompts: number;
  toolCalls: number;
  /** Lab fires: an agent's second (or later) failed test run in a row. */
  fires: number;
  /** Scary commands (rm -rf, --force, …). */
  scary: number;
  /** Coffee breaks: turns that ended on a rate limit or an overloaded API. */
  coffeeBreaks: number;
  /** Pushes (or other ship commands) that failed. */
  failedPushes: number;
}

export interface OfficeStats {
  /** Server-local date, YYYY-MM-DD. */
  day: string;
  today: StatCounters & { peakWorking: number };
  /** Tool calls per hour of today, 0–23. */
  hourly: number[];
  allTime: StatCounters & { since: number };
  /** Unlocked achievements, oldest first. */
  achievements: { id: AchievementId; at: number }[];
}

export const ACHIEVEMENTS = [
  { id: "first-launch", icon: "🚀", title: "Liftoff", desc: "The office's first rocket launch." },
  { id: "space-program", icon: "🛰", title: "Space Program", desc: "10 launches in one day." },
  { id: "pyromaniac", icon: "🔥", title: "Pyromaniac", desc: "3 lab fires, all time." },
  { id: "green-wall", icon: "🧪", title: "Green Wall", desc: "20 passing test runs in one day." },
  { id: "crunch-time", icon: "🍕", title: "Crunch Time", desc: "5 agents working at once." },
  { id: "delegator", icon: "👥", title: "Delegator", desc: "A manager with 5 sub-agents at once." },
  { id: "night-owl", icon: "🦉", title: "Night Owl", desc: "Work between midnight and 5 a.m." },
  { id: "marathon", icon: "🏃", title: "Marathon", desc: "An agent working for over 2 hours." },
  { id: "thousand-cuts", icon: "✂", title: "Thousand Cuts", desc: "1,000 edits, all time." },
  { id: "big-brain", icon: "🧠", title: "Big Brain", desc: "A context window over 80% full." },
  { id: "living-dangerously", icon: "😱", title: "Living Dangerously", desc: "Someone ran a scary command." },
  { id: "bug-squasher", icon: "🐛", title: "Bug Squasher", desc: "Tests pass after 3+ failures in a row." },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];

/** A person who sends agents to the office (with one or more ingest tokens of their own). */
export interface OfficeUser {
  id: string;
  name: string;
  /** "admin" manages people, screens and settings; "member" watches and manages their own tokens. */
  role: "admin" | "member";
  createdAt: number;
  /** Last time one of their agents sent an event. */
  lastSeenAt?: number;
  /** They've set their own password (they can log in with it as well as their token). */
  hasPassword?: boolean;
}

/**
 * One of a person's ingest tokens, as their "You" panel lists it (GET /api/me/tokens).
 * The token itself is stored only as a hash and shown once, when it's made.
 */
export interface TokenInfo {
  id: string;
  /** What it's for, e.g. "Work laptop". */
  name: string;
  /** The token's last 4 characters, to tell it apart from the others ("…a1B2"). Missing on tokens made before this existed. */
  hint?: string;
  createdAt: number;
  /** Last time an agent sent an event with it, or someone logged in with it. */
  lastUsedAt?: number;
}

/** A read-only link for a screen (TV) in the office. */
export interface DisplayLink {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * Who is looking at the office:
 *  - "admin": a person with the admin role, or the admin token — can change settings, people, screens;
 *  - "member": a person — watches, and manages their own tokens and password;
 *  - "viewer": a TV code — only watches.
 */
export type Role = "admin" | "member" | "viewer";

/** GET /api/me */
export interface Me {
  role: Role;
  /** The logged-in person, if it's a person (not the admin token or a TV). */
  user?: { id: string; name: string; hasPassword?: boolean };
}

/** Messages the server sends to browsers over the WebSocket. */
export type ServerMessage =
  | { t: "snapshot"; state: import("./state.js").OfficeState }
  | { t: "event"; e: AgentEvent }
  | { t: "settings"; settings: OfficeSettings }
  | { t: "stats"; stats: OfficeStats }
  /** Which build of the web app the server is serving; browsers reload when it changes. */
  | { t: "version"; id: string };
