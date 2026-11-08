import { categorizeTool, projectFromPath, summarizeTool, detailTool, type AgentEvent } from "@pixel-office/protocol";
import { isObj, str, todoStatus, validEvents, withDetail, type Adapter, type Obj } from "./common.js";

/**
 * Claude Code hook payloads → AgentEvents.
 * Field reference: https://code.claude.com/docs/en/hooks
 */
export function claudeToEvents(payload: unknown, now: number): AgentEvent[] {
  if (!isObj(payload)) return [];
  const event = str(payload, "hook_event_name");
  const sessionId = str(payload, "session_id");
  if (!event || !sessionId) return [];

  const agentIdRaw = str(payload, "agent_id");
  const base = {
    source: "claude",
    agentId: `claude:${agentIdRaw ?? sessionId}`,
    sessionId: `claude:${sessionId}`,
    ...(agentIdRaw ? { parentAgentId: `claude:${sessionId}` } : {}),
    ...(str(payload, "agent_type") ? { label: str(payload, "agent_type") } : {}),
    project: projectFromPath(str(payload, "cwd")),
    ts: now,
  };
  const toolName = str(payload, "tool_name");
  const toolInput = isObj(payload.tool_input) ? payload.tool_input : undefined;
  const callId = str(payload, "tool_use_id");

  const out: unknown[] = [];
  // Context window use (sent by the hook as a header, merged in by the ingest route).
  // transcript_path is always the main session's, so it belongs to the main agent.
  const contextTokens = payload._context_tokens;
  if (typeof contextTokens === "number" && contextTokens > 0 && event !== "SubagentStop") {
    out.push({
      source: "claude",
      agentId: `claude:${sessionId}`,
      sessionId: `claude:${sessionId}`,
      project: base.project,
      ts: now,
      kind: "context",
      tokens: Math.round(contextTokens),
    });
  }
  // Background commands that finished (the hook finds them in the transcript at the end of a turn).
  if (Array.isArray(payload._jobs)) {
    for (const j of payload._jobs) {
      if (!isObj(j)) continue;
      const id = str(j, "callId");
      const status = str(j, "status");
      if (id && status) {
        // Sent for the main agent; the reducer hands it to whichever agent of the session started the job.
        out.push({ source: "claude", agentId: `claude:${sessionId}`, sessionId: `claude:${sessionId}`, project: base.project, ts: now, kind: "job.end", callId: id, ok: status === "completed" });
      }
    }
  }
  const branch = payload._git_branch;
  if (typeof branch === "string" && branch) {
    out.push({ source: "claude", agentId: `claude:${sessionId}`, sessionId: `claude:${sessionId}`, project: base.project, ts: now, kind: "branch", branch });
  }
  switch (event) {
    case "SessionStart":
      out.push({ ...base, kind: "session.start" });
      break;
    case "SessionEnd":
      out.push({ ...base, kind: "session.end", ok: true });
      break;
    case "UserPromptSubmit": {
      const text = str(payload, "prompt");
      if (text) out.push({ ...base, kind: "prompt", text });
      break;
    }
    case "PreToolUse": {
      if (!toolName || !callId) break;
      out.push({
        ...base,
        kind: "tool.start",
        callId,
        tool: toolName,
        category: categorizeTool(toolName),
        summary: summarizeTool(toolName, toolInput),
        ...withDetail(detailTool(toolName, toolInput)),
      });
      // A command left running in the background: the office follows it until it finishes.
      if (toolName === "Bash" && toolInput?.run_in_background === true) {
        const label = str(toolInput, "description");
        // The summary is the command itself (not the description), so a test run is recognised as one.
        const { description: _, ...command } = toolInput;
        out.push({ ...base, kind: "job.start", callId, summary: summarizeTool(toolName, command), ...(label ? { label } : {}) });
      }
      if (toolName === "SendMessage") {
        const to = str(toolInput, "to") ?? str(toolInput, "recipient");
        const text = str(toolInput, "message") ?? str(toolInput, "content") ?? str(toolInput, "summary");
        if (to && text) out.push({ ...base, kind: "message", to, text });
      }
      if (toolName === "AskUserQuestion") {
        out.push({ ...base, kind: "waiting", reason: "question", text: firstQuestion(toolInput) ?? "Question" });
      }
      if (toolName === "TodoWrite") {
        const items = todoItems(toolInput?.todos);
        if (items) out.push({ ...base, kind: "todos", items });
      }
      if (toolName === "TaskUpdate") {
        const id = str(toolInput, "taskId") ?? str(toolInput, "task_id");
        const status = todoStatus(str(toolInput, "status"));
        if (id && status) {
          const text = str(toolInput, "subject") ?? "";
          out.push({ ...base, kind: "todo", item: { id, text, status } });
        }
      }
      break;
    }
    case "TaskCreated": {
      const id = str(payload, "task_id");
      const text = str(payload, "task_subject");
      if (id && text) out.push({ ...base, kind: "todo", item: { id, text, status: "pending" } });
      break;
    }
    case "TaskCompleted": {
      const id = str(payload, "task_id");
      if (id) out.push({ ...base, kind: "todo", item: { id, text: str(payload, "task_subject") ?? "", status: "completed" } });
      break;
    }
    case "PostToolUse":
      if (callId) out.push({ ...base, kind: "tool.end", callId, ok: true });
      break;
    case "PostToolUseFailure":
      if (callId) out.push({ ...base, kind: "tool.end", callId, ok: false });
      break;
    case "PermissionRequest":
      out.push({
        ...base,
        kind: "waiting",
        reason: "permission",
        text: toolName ? summarizeTool(toolName, toolInput) : "Permission needed",
      });
      break;
    case "Notification": {
      const type = str(payload, "notification_type");
      const message = str(payload, "message");
      if (type === "permission_prompt") {
        out.push({ ...base, kind: "waiting", reason: "permission", ...(message ? { text: message } : {}) });
      } else if (type === "idle_prompt") {
        out.push({ ...base, kind: "idle" });
      } else if (type === "elicitation_dialog" || type === "agent_needs_input") {
        out.push({ ...base, kind: "waiting", reason: "question", ...(message ? { text: message } : {}) });
      }
      break;
    }
    case "Stop":
    case "TeammateIdle":
      out.push({ ...base, kind: "idle" });
      break;
    case "StopFailure":
      out.push({ ...base, kind: "error", text: str(payload, "error") ?? "error" });
      break;
    case "SubagentStart":
      if (agentIdRaw) out.push({ ...base, kind: "session.start" });
      break;
    case "SubagentStop":
      if (agentIdRaw) {
        const report = str(payload, "last_assistant_message");
        out.push({ ...base, kind: "session.end", ok: true, ...(report ? { report } : {}) });
      }
      break;
    case "PreCompact":
      out.push({ ...base, kind: "compact" });
      break;
  }
  return validEvents(out);
}

/** TodoWrite's `todos` array → todo items (text = content). */
function todoItems(raw: unknown): { id?: string; text: string; status: "pending" | "in_progress" | "completed" }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = [];
  for (const t of raw.slice(0, 100)) {
    if (!isObj(t)) continue;
    const text = str(t, "content") ?? str(t, "subject");
    const status = todoStatus(str(t, "status"));
    if (!text || !status) continue;
    const id = str(t, "id");
    items.push({ ...(id ? { id } : {}), text, status });
  }
  return items;
}

function firstQuestion(input: Obj | undefined): string | undefined {
  const qs = input?.questions;
  if (Array.isArray(qs) && isObj(qs[0])) return str(qs[0], "question");
  return str(input, "question");
}

export const claudeAdapter: Adapter = { toEvents: claudeToEvents };
