import { DEFAULT_CONTEXT_LIMIT, type AgentEvent } from "./events.js";
import { isGitCommand, isTestRun } from "./tools.js";
import { nameFor } from "./names.js";
import {
  ENDED_RETENTION_MS,
  JOB_GIVE_UP_MS,
  RECENT_JOBS,
  RECENT_TOOLS,
  type Activity,
  type AgentState,
  type Job,
  type OfficeState,
  type ToolCall,
} from "./state.js";

/**
 * Pure: (state, event) → new state. Runs on the server and in every browser,
 * so both always agree. Never mutates its inputs.
 */
export function reduce(state: OfficeState, e: AgentEvent): OfficeState {
  // A job's end goes to the agent that started it (a sub-agent's jobs are reported by its session).
  if (e.kind === "job.end") {
    const callId = e.callId;
    const owns = (x: AgentState | undefined) => !!x?.jobs?.some((j) => j.callId === callId);
    const owner = owns(state.agents[e.agentId]) ? undefined : Object.values(state.agents).find((x) => x.sessionId === e.sessionId && owns(x));
    if (owner) e = { ...e, agentId: owner.id };
  }
  const now = Math.max(state.now, e.ts);
  const agents = pruneEnded(state.agents, now);
  const next: OfficeState = { agents, version: state.version + 1, now };

  const existing = agents[e.agentId];
  if (!existing && e.kind === "session.end") return next;

  const a: AgentState = existing ? { ...existing } : newAgent(e, new Set(Object.values(agents).map((x) => x.name)));
  a.lastEventAt = e.ts;
  if (e.project.name !== "unknown") a.project = e.project;
  if (e.label) a.label = e.label;
  if (e.user) a.user = e.user;
  if (e.parentAgentId) a.parentId = e.parentAgentId;
  if (a.status === "ended" && e.kind !== "session.end") {
    a.status = "idle";
    a.activity = "idle";
    delete a.endedAt;
    delete a.endedOk;
  }
  agents[a.id] = a;

  switch (e.kind) {
    case "session.start": {
      if (!existing && a.parentId) {
        setActivity(a, "thinking", e.ts, "working");
        claimDelegation(agents, a, e.ts);
      }
      break;
    }
    case "session.end": {
      a.status = "ended";
      setActivity(a, "ended", e.ts);
      a.endedAt = e.ts;
      if (e.ok !== undefined) a.endedOk = e.ok;
      a.openCalls = [];
      a.pendingDelegations = [];
      delete a.waiting;
      if (a.parentId) {
        a.lastSaid = {
          kind: "report",
          text: e.report ?? (e.ok === false ? "failed" : "done"),
          at: e.ts,
          withAgentId: a.parentId,
        };
      }
      break;
    }
    case "prompt": {
      a.prompt = e.text;
      endWait(a, e.ts);
      setActivity(a, "thinking", e.ts, "working");
      a.lastSaid = { kind: "prompt", text: e.text, at: e.ts };
      break;
    }
    case "busy": {
      endWait(a, e.ts, "approved");
      if (a.status !== "working") setActivity(a, currentActivity(a), e.ts, "working");
      break;
    }
    case "tool.start": {
      const call: ToolCall = {
        callId: e.callId,
        tool: e.tool,
        category: e.category,
        summary: e.summary ?? e.tool,
        ...(e.detail ? { detail: e.detail } : {}),
        startedAt: e.ts,
      };
      a.openCalls = [...a.openCalls.filter((c) => c.callId !== e.callId), call];
      a.recentTools = [...a.recentTools, call].slice(-RECENT_TOOLS);
      if (e.category === "delegate") a.pendingDelegations = [...a.pendingDelegations, e.callId];
      endWait(a, e.ts);
      setActivity(a, activityFor(call), e.ts, "working");
      break;
    }
    case "tool.end": {
      a.openCalls = a.openCalls.filter((c) => c.callId !== e.callId);
      a.recentTools = a.recentTools.map((c) =>
        c.callId === e.callId && c.endedAt === undefined ? { ...c, endedAt: e.ts, ok: e.ok } : c,
      );
      a.pendingDelegations = a.pendingDelegations.filter((id) => id !== e.callId);
      if (!e.ok) a.lastErrorAt = e.ts;
      const ended = existing?.openCalls.find((c) => c.callId === e.callId);
      // A background command's call returns as soon as it has started; its result comes with job.end.
      const background = a.jobs?.some((j) => j.callId === e.callId);
      if (e.ok && ended && !background && isTestRun(ended.tool, ended.summary)) a.lastWinAt = e.ts;
      // Its own call ran: approved. Another call finishing says nothing about the answer.
      endWait(a, e.ts, a.waiting?.callId === e.callId ? "approved" : null);
      setActivity(a, currentActivity(a), e.ts, "working");
      break;
    }
    case "waiting": {
      // A second notice about the same wait (Claude Code repeats a permission prompt as a notification) keeps when it began.
      const same = existing?.waiting?.reason === e.reason ? existing.waiting : undefined;
      const callId = e.callId ?? same?.callId ?? a.openCalls[a.openCalls.length - 1]?.callId;
      a.waiting = { reason: e.reason, ...(e.text ? { text: e.text } : {}), since: same?.since ?? e.ts, ...(callId ? { callId } : {}) };
      setActivity(a, "waiting", e.ts, "waiting");
      a.lastSaid = { kind: e.reason, text: e.text ?? (e.reason === "permission" ? "May I?" : "Question"), at: e.ts };
      break;
    }
    case "idle": {
      endWait(a, e.ts);
      a.openCalls = [];
      a.pendingDelegations = [];
      // Turn over, but background commands still running: it's waiting on them, not on you.
      if (runningJobs(a, e.ts).length) setActivity(a, "background", e.ts, "working");
      else setActivity(a, "idle", e.ts, "idle");
      break;
    }
    case "job.start": {
      const job: Job = { callId: e.callId, summary: e.summary, ...(e.label ? { label: e.label } : {}), startedAt: e.ts };
      a.jobs = keepJobs([...(a.jobs ?? []).filter((j) => j.callId !== e.callId), job], e.ts);
      break;
    }
    case "job.end": {
      const job = a.jobs?.find((j) => j.callId === e.callId);
      // Unknown, or already ended (the hook reports finished jobs on every turn end): nothing new.
      if (!job || job.endedAt !== undefined) break;
      a.jobs = keepJobs(a.jobs!.map((j) => (j === job ? { ...j, endedAt: e.ts, ok: e.ok } : j)), e.ts);
      if (e.ok && isTestRun("Bash", job.summary)) a.lastWinAt = e.ts;
      if (!e.ok) a.lastErrorAt = e.ts;
      if (a.activity === "background" && !runningJobs(a, e.ts).length) setActivity(a, "idle", e.ts, "idle");
      break;
    }
    case "compact": {
      setActivity(a, "compact", e.ts, "working");
      break;
    }
    case "error": {
      a.lastErrorAt = e.ts;
      a.lastError = { text: e.text ?? "error", at: e.ts };
      endWait(a, e.ts);
      a.openCalls = [];
      a.pendingDelegations = [];
      setActivity(a, "idle", e.ts, "idle");
      break;
    }
    case "context": {
      const limit = e.limit ?? (e.tokens > DEFAULT_CONTEXT_LIMIT ? 1_000_000 : DEFAULT_CONTEXT_LIMIT);
      a.context = { tokens: e.tokens, limit, at: e.ts };
      break;
    }
    case "branch": {
      a.branch = e.branch;
      break;
    }
    case "todos": {
      a.todos = e.items;
      break;
    }
    case "todo": {
      const list = [...(a.todos ?? [])];
      const i = e.item.id ? list.findIndex((t) => t.id === e.item.id) : list.findIndex((t) => t.text === e.item.text);
      if (i >= 0) list[i] = { ...list[i]!, ...e.item, text: e.item.text || list[i]!.text };
      else if (e.item.text) list.push(e.item); // an update for a todo we never saw, with no text: nothing to show
      else break;
      a.todos = list.slice(-100);
      break;
    }
    case "message": {
      const to = resolveAgent(agents, a, e.to);
      a.lastSaid = { kind: "message", text: e.text, at: e.ts, ...(to ? { withAgentId: to.id } : {}) };
      break;
    }
  }
  return next;
}

export function reduceAll(state: OfficeState, events: Iterable<AgentEvent>): OfficeState {
  let s = state;
  for (const e of events) s = reduce(s, e);
  return s;
}

function newAgent(e: AgentEvent, takenNames: ReadonlySet<string>): AgentState {
  return {
    id: e.agentId,
    source: e.source,
    sessionId: e.sessionId,
    ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}),
    name: nameFor(e.agentId, takenNames),
    ...(e.label ? { label: e.label } : {}),
    project: e.project,
    status: "idle",
    activity: "idle",
    activitySince: e.ts,
    openCalls: [],
    recentTools: [],
    pendingDelegations: [],
    startedAt: e.ts,
    lastEventAt: e.ts,
  };
}

/** Background jobs still running at `now`. */
export function runningJobs(a: Pick<AgentState, "jobs">, now: number): Job[] {
  return (a.jobs ?? []).filter((j) => j.endedAt === undefined && now - j.startedAt < JOB_GIVE_UP_MS);
}

/** All running jobs plus the last few finished ones, oldest first. */
function keepJobs(jobs: Job[], now: number): Job[] {
  const running = new Set(runningJobs({ jobs }, now));
  const finished = jobs.filter((j) => !running.has(j)).slice(-RECENT_JOBS);
  return jobs.filter((j) => running.has(j) || finished.includes(j));
}

/** A tool call's activity: its category, except test runs (test lab) and git work (git room). */
function activityFor(call: Pick<ToolCall, "tool" | "category" | "summary">): Activity {
  if (isTestRun(call.tool, call.summary)) return "test";
  if (isGitCommand(call.tool, call.summary)) return "git";
  return call.category;
}

/** The activity implied by the newest still-running call, or "thinking". */
function currentActivity(a: AgentState): Activity {
  const last = a.openCalls[a.openCalls.length - 1];
  return last ? activityFor(last) : "thinking";
}

/**
 * The wait is over. `outcome`: how it was answered; by default the wait was
 * denied (it ended without its tool call running), or unknown when it was
 * about no particular call. `null`: over, but say nothing about the answer.
 */
function endWait(a: AgentState, ts: number, outcome?: "approved" | "denied" | null): void {
  const w = a.waiting;
  if (!w) return;
  delete a.waiting;
  const result = outcome === undefined ? (w.callId ? "denied" : null) : outcome;
  if (result) a.lastAnswer = { outcome: result, at: ts };
}

function setActivity(a: AgentState, activity: Activity, ts: number, status?: AgentState["status"]): void {
  if (a.activity !== activity) {
    a.activity = activity;
    a.activitySince = ts;
  }
  if (status) a.status = status;
}

/** Links a newly started sub-agent to the oldest unmatched delegation of its parent. */
function claimDelegation(agents: Record<string, AgentState>, child: AgentState, ts: number): void {
  const parentId = child.parentId;
  if (!parentId) return;
  const parent = agents[parentId];
  if (!parent) {
    if (child.label) child.task = child.label;
    return;
  }
  const [callId, ...rest] = parent.pendingDelegations;
  const call = callId ? parent.openCalls.find((c) => c.callId === callId) : undefined;
  const task = call?.summary.replace(/^Delegate: /, "") ?? child.label;
  if (task) child.task = task;
  if (call?.detail) child.taskBrief = call.detail;
  agents[parentId] = {
    ...parent,
    pendingDelegations: rest,
    lastSaid: {
      kind: "delegate",
      text: task ?? "Can you take this?",
      at: ts,
      withAgentId: child.id,
    },
  };
}

function resolveAgent(
  agents: Record<string, AgentState>,
  from: AgentState,
  to: string,
): AgentState | undefined {
  const direct = agents[to];
  if (direct) return direct;
  const needle = to.toLowerCase();
  return Object.values(agents).find(
    (x) =>
      x.id !== from.id &&
      x.sessionId === from.sessionId &&
      (x.label?.toLowerCase() === needle || x.name.toLowerCase() === needle),
  );
}

function pruneEnded(agents: Record<string, AgentState>, now: number): Record<string, AgentState> {
  const out: Record<string, AgentState> = {};
  for (const [id, a] of Object.entries(agents)) {
    if (a.status === "ended" && a.endedAt !== undefined && now - a.endedAt > ENDED_RETENTION_MS) continue;
    out[id] = a;
  }
  return out;
}
