import { categorizeTool, projectFromPath, summarizeTool, type AgentEvent } from "@pixel-office/protocol";
import { isObj, str, validEvents, type Adapter, type Obj } from "./common.js";

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
      });
      if (toolName === "SendMessage") {
        const to = str(toolInput, "to") ?? str(toolInput, "recipient");
        const text = str(toolInput, "message") ?? str(toolInput, "content") ?? str(toolInput, "summary");
        if (to && text) out.push({ ...base, kind: "message", to, text });
      }
      if (toolName === "AskUserQuestion") {
        out.push({ ...base, kind: "waiting", reason: "question", text: firstQuestion(toolInput) ?? "Question" });
      }
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

function firstQuestion(input: Obj | undefined): string | undefined {
  const qs = input?.questions;
  if (Array.isArray(qs) && isObj(qs[0])) return str(qs[0], "question");
  return str(input, "question");
}

export const claudeAdapter: Adapter = { toEvents: claudeToEvents };
