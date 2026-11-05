import type { AgentEvent, ToolCategory } from "./events.js";
import { nameFor } from "./names.js";
import {
  ENDED_RETENTION_MS,
  RECENT_TOOLS,
  type Activity,
  type AgentState,
  type OfficeState,
  type ToolCall,
} from "./state.js";

/**
 * Pure: (state, event) → new state. Runs on the server and in every browser,
 * so both always agree. Never mutates its inputs.
 */
export function reduce(state: OfficeState, e: AgentEvent): OfficeState {
  const now = Math.max(state.now, e.ts);
  const agents = pruneEnded(state.agents, now);
  const next: OfficeState = { agents, version: state.version + 1, now };

  const existing = agents[e.agentId];
  if (!existing && e.kind === "session.end") return next;

  const a: AgentState = existing ? { ...existing } : newAgent(e, new Set(Object.values(agents).map((x) => x.name)));
  a.lastEventAt = e.ts;
  if (e.project.name !== "unknown") a.project = e.project;
  if (e.label) a.label = e.label;
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
      delete a.waiting;
      setActivity(a, "thinking", e.ts, "working");
      a.lastSaid = { kind: "prompt", text: e.text, at: e.ts };
      break;
    }
    case "busy": {
      delete a.waiting;
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
      delete a.waiting;
      setActivity(a, activityFor(e.category), e.ts, "working");
      break;
    }
    case "tool.end": {
      a.openCalls = a.openCalls.filter((c) => c.callId !== e.callId);
      a.recentTools = a.recentTools.map((c) =>
        c.callId === e.callId && c.endedAt === undefined ? { ...c, endedAt: e.ts, ok: e.ok } : c,
      );
      a.pendingDelegations = a.pendingDelegations.filter((id) => id !== e.callId);
      if (!e.ok) a.lastErrorAt = e.ts;
      delete a.waiting;
      setActivity(a, currentActivity(a), e.ts, "working");
      break;
    }
    case "waiting": {
      a.waiting = { reason: e.reason, ...(e.text ? { text: e.text } : {}), since: e.ts };
      setActivity(a, "waiting", e.ts, "waiting");
      a.lastSaid = { kind: e.reason, text: e.text ?? (e.reason === "permission" ? "May I?" : "Question"), at: e.ts };
      break;
    }
    case "idle": {
      a.openCalls = [];
      a.pendingDelegations = [];
      delete a.waiting;
      setActivity(a, "idle", e.ts, "idle");
      break;
    }
    case "compact": {
      setActivity(a, "compact", e.ts, "working");
      break;
    }
    case "error": {
      a.lastErrorAt = e.ts;
      a.openCalls = [];
      a.pendingDelegations = [];
      delete a.waiting;
      setActivity(a, "idle", e.ts, "idle");
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

function activityFor(category: ToolCategory): Activity {
  return category;
}

/** The activity implied by the newest still-running call, or "thinking". */
function currentActivity(a: AgentState): Activity {
  const last = a.openCalls[a.openCalls.length - 1];
  return last ? activityFor(last.category) : "thinking";
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
