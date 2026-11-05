import { describe, expect, it } from "vitest";
import { claudeToEvents } from "../src/adapters/claude.js";

const NOW = 1_700_000_000_000;
const common = {
  session_id: "abc123",
  transcript_path: "/Users/dev/.claude/projects/x/abc123.jsonl",
  cwd: "/Users/dev/code/my-project",
  permission_mode: "default",
};
const run = (p: Record<string, unknown>) => claudeToEvents({ ...common, ...p }, NOW);

describe("claude adapter", () => {
  it("maps SessionStart with identity and project", () => {
    const [e] = run({ hook_event_name: "SessionStart", source: "startup", model: "claude-opus-5" });
    expect(e).toMatchObject({
      kind: "session.start",
      source: "claude",
      agentId: "claude:abc123",
      sessionId: "claude:abc123",
      project: { path: "/Users/dev/code/my-project", name: "my-project" },
      ts: NOW,
    });
    expect(e).not.toHaveProperty("parentAgentId");
  });

  it("maps SessionEnd and UserPromptSubmit", () => {
    expect(run({ hook_event_name: "SessionEnd", reason: "other" })[0]).toMatchObject({ kind: "session.end" });
    expect(run({ hook_event_name: "UserPromptSubmit", prompt: "fix the bug" })[0]).toMatchObject({
      kind: "prompt",
      text: "fix the bug",
    });
  });

  it("maps PreToolUse to a summarized tool.start without leaking input", () => {
    const events = run({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test", description: "Run test suite", timeout: 120000 },
      tool_use_id: "toolu_01",
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "tool.start", callId: "toolu_01", tool: "Bash", category: "shell", summary: "Bash: Run test suite" }),
    ]);
    const write = run({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/a/secret.ts", content: "TOP SECRET" },
      tool_use_id: "toolu_02",
    });
    expect(JSON.stringify(write)).not.toContain("TOP SECRET");
  });

  it("carries the delegation brief as detail on Agent calls only", () => {
    const [agent] = run({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { description: "find usages", prompt: "Find every caller of useAuth and list the files", subagent_type: "Explore" },
      tool_use_id: "toolu_03",
    });
    expect(agent).toMatchObject({ category: "delegate", summary: "Delegate: find usages", detail: "Find every caller of useAuth and list the files" });
    const [read] = run({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a/b.ts" }, tool_use_id: "toolu_04" });
    expect(read).not.toHaveProperty("detail");
  });

  it("maps PostToolUse / PostToolUseFailure to tool.end", () => {
    expect(run({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1", tool_response: {} })[0]).toMatchObject({
      kind: "tool.end",
      callId: "t1",
      ok: true,
    });
    expect(
      run({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "t2", error: "exit 1" })[0],
    ).toMatchObject({ kind: "tool.end", callId: "t2", ok: false });
  });

  it("emits a message event for SendMessage and a question for AskUserQuestion", () => {
    const send = run({
      hook_event_name: "PreToolUse",
      tool_name: "SendMessage",
      tool_input: { to: "researcher", message: "check the docs" },
      tool_use_id: "t3",
    });
    expect(send.map((e) => e.kind)).toEqual(["tool.start", "message"]);
    expect(send[1]).toMatchObject({ to: "researcher", text: "check the docs" });

    const ask = run({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Which database?", options: [] }] },
      tool_use_id: "t4",
    });
    expect(ask[1]).toMatchObject({ kind: "waiting", reason: "question", text: "Which database?" });
  });

  it("maps PermissionRequest and Notification types", () => {
    expect(
      run({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf dist" } })[0],
    ).toMatchObject({ kind: "waiting", reason: "permission", text: "Bash: rm -rf dist" });
    expect(
      run({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" })[0],
    ).toMatchObject({ kind: "waiting", reason: "permission" });
    expect(run({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "x" })[0]).toMatchObject({ kind: "idle" });
    expect(run({ hook_event_name: "Notification", notification_type: "elicitation_dialog", message: "x" })[0]).toMatchObject({
      kind: "waiting",
      reason: "question",
    });
    expect(run({ hook_event_name: "Notification", notification_type: "auth_success", message: "x" })).toEqual([]);
  });

  it("maps Stop, StopFailure, PreCompact, TeammateIdle", () => {
    expect(run({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "done" })[0]).toMatchObject({ kind: "idle" });
    expect(run({ hook_event_name: "StopFailure", error: "rate_limit" })[0]).toMatchObject({ kind: "error", text: "rate_limit" });
    expect(run({ hook_event_name: "PreCompact", trigger: "auto", custom_instructions: null })[0]).toMatchObject({ kind: "compact" });
    expect(
      run({ hook_event_name: "TeammateIdle", agent_id: "tm1", teammate_name: "researcher", team_name: "t" })[0],
    ).toMatchObject({ kind: "idle", agentId: "claude:tm1" });
  });

  it("maps sub-agents with a parent link and a report", () => {
    const [start] = run({ hook_event_name: "SubagentStart", agent_id: "agent-def456", agent_type: "Explore" });
    expect(start).toMatchObject({
      kind: "session.start",
      agentId: "claude:agent-def456",
      parentAgentId: "claude:abc123",
      sessionId: "claude:abc123",
      label: "Explore",
    });
    const [stop] = run({
      hook_event_name: "SubagentStop",
      agent_id: "agent-def456",
      agent_type: "Explore",
      stop_hook_active: false,
      last_assistant_message: "Analysis complete. Found 3 potential issues...",
    });
    expect(stop).toMatchObject({ kind: "session.end", ok: true, report: "Analysis complete. Found 3 potential issues..." });

    // tool events inside a sub-agent are attributed to the sub-agent
    const [tool] = run({ hook_event_name: "PreToolUse", agent_id: "agent-def456", tool_name: "Grep", tool_input: { pattern: "x" }, tool_use_id: "t9" });
    expect(tool).toMatchObject({ agentId: "claude:agent-def456", parentAgentId: "claude:abc123" });
  });

  it("ignores unknown events and malformed payloads", () => {
    expect(run({ hook_event_name: "ConfigChange" })).toEqual([]);
    expect(claudeToEvents(null, NOW)).toEqual([]);
    expect(claudeToEvents({ hook_event_name: "SessionStart" }, NOW)).toEqual([]);
    expect(claudeToEvents("nope", NOW)).toEqual([]);
  });

  it("maps TodoWrite to a full todo list and Task hooks to single todos", () => {
    const [, todos] = run({
      hook_event_name: "PreToolUse",
      tool_name: "TodoWrite",
      tool_use_id: "toolu_t",
      tool_input: {
        todos: [
          { content: "Write the adapter", status: "completed", activeForm: "Writing the adapter" },
          { content: "Test it", status: "in_progress", activeForm: "Testing it" },
        ],
      },
    });
    expect(todos).toMatchObject({
      kind: "todos",
      items: [
        { text: "Write the adapter", status: "completed" },
        { text: "Test it", status: "in_progress" },
      ],
    });
    expect(run({ hook_event_name: "TaskCreated", task_id: "task-1", task_subject: "Add login" })).toEqual([
      expect.objectContaining({ kind: "todo", item: { id: "task-1", text: "Add login", status: "pending" } }),
    ]);
    expect(run({ hook_event_name: "TaskCompleted", task_id: "task-1", task_subject: "Add login" })).toEqual([
      expect.objectContaining({ kind: "todo", item: { id: "task-1", text: "Add login", status: "completed" } }),
    ]);
    const [, upd] = run({ hook_event_name: "PreToolUse", tool_name: "TaskUpdate", tool_use_id: "toolu_u", tool_input: { taskId: "task-1", status: "in_progress" } });
    expect(upd).toMatchObject({ kind: "todo", item: { id: "task-1", status: "in_progress" } });
  });

  it("maps StopFailure to an error carrying the error type", () => {
    expect(run({ hook_event_name: "StopFailure", error: "rate_limit", error_details: "429" })).toEqual([
      expect.objectContaining({ kind: "error", text: "rate_limit" }),
    ]);
  });

  it("attaches context use to the main agent, never to a finishing sub-agent", () => {
    const [ctx] = run({ hook_event_name: "Stop", _context_tokens: 90_000 });
    expect(ctx).toMatchObject({ kind: "context", agentId: "claude:abc123", tokens: 90_000 });
    const sub = run({ hook_event_name: "SubagentStop", agent_id: "x", _context_tokens: 5 });
    expect(sub.some((e) => e.kind === "context")).toBe(false);
  });
});

