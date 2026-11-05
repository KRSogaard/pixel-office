import type { ToolCategory } from "./events.js";

/**
 * Tool names → category. Keys are lower-cased so Claude Code ("Read") and
 * OpenCode ("read") share one table.
 */
const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  edit: "edit",
  write: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  patch: "edit",
  apply_patch: "edit",

  read: "read",
  grep: "read",
  glob: "read",
  ls: "read",
  list: "read",
  lsp: "read",
  codesearch: "read",
  notebookread: "read",

  bash: "shell",
  bashoutput: "shell",
  killshell: "shell",
  powershell: "shell",
  monitor: "shell",

  webfetch: "web",
  websearch: "web",

  agent: "delegate",
  task: "delegate",

  sendmessage: "message",
};

export function categorizeTool(tool: string): ToolCategory {
  if (tool.startsWith("mcp__")) return "mcp";
  return CATEGORY_BY_TOOL[tool.toLowerCase()] ?? "other";
}

type Input = Record<string, unknown> | undefined | null;

function str(input: Input, ...keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Does this shell call look like a test run? ("npm test", "vitest", "dotnet test", "pytest", …) */
export function isTestRun(tool: string, summary: string): boolean {
  if (categorizeTool(tool) !== "shell") return false;
  return /\b(test|tests|vitest|jest|pytest|mocha|rspec|phpunit|xunit|nunit|cargo test|go test|playwright)\b/i.test(summary);
}

/** Does this shell call do git work? ("git commit", "git push", "gh pr create", …) */
export function isGitCommand(tool: string, summary: string): boolean {
  if (categorizeTool(tool) !== "shell") return false;
  return /\b(git (commit|push|pull|merge|rebase|tag|checkout|switch|cherry-pick|stash|fetch|reset|revert)|gh (pr|release|repo))\b/i.test(summary);
}

/** Does this shell call ship something? (push, PR, release) — a rocket launches. */
export function isShipCommand(tool: string, summary: string): boolean {
  if (categorizeTool(tool) !== "shell") return false;
  return /\b(git push|gh pr (create|merge)|gh release create)\b/i.test(summary);
}

/**
 * Longer context worth showing for a call, or undefined. Today: the brief a parent
 * writes when it delegates to a sub-agent (Claude `Agent`/`Task`, OpenCode `task`).
 */
export function detailTool(tool: string, input: Input): string | undefined {
  if (categorizeTool(tool) !== "delegate") return undefined;
  return str(input, "prompt");
}

/**
 * A short human description of a tool call: "Read app.ts", "Bash: npm test".
 * Never includes file contents or other large inputs.
 */
export function summarizeTool(tool: string, input: Input): string {
  if (tool.startsWith("mcp__")) {
    const [, server = "", name = ""] = tool.split("__");
    return `${server}: ${name}`;
  }
  const t = tool.toLowerCase();
  const file = str(input, "file_path", "filePath", "notebook_path", "path");
  switch (t) {
    case "read":
    case "edit":
    case "write":
    case "multiedit":
    case "notebookedit":
    case "notebookread":
      return file ? `${tool} ${basename(file)}` : tool;
    case "bash":
    case "powershell": {
      const d = str(input, "description") ?? str(input, "command");
      return d ? `${tool}: ${d}` : tool;
    }
    case "grep":
    case "glob": {
      const p = str(input, "pattern");
      return p ? `${tool} "${p}"` : tool;
    }
    case "ls":
    case "list":
      return file ? `${tool} ${basename(file)}` : tool;
    case "webfetch": {
      const u = str(input, "url");
      return u ? `Fetch ${host(u)}` : tool;
    }
    case "websearch": {
      const q = str(input, "query");
      return q ? `Search "${q}"` : tool;
    }
    case "agent":
    case "task": {
      const d = str(input, "description") ?? str(input, "subagent_type");
      return d ? `Delegate: ${d}` : "Delegate";
    }
    case "sendmessage": {
      const to = str(input, "to", "recipient");
      return to ? `Message ${to}` : "Message";
    }
    case "skill": {
      const s = str(input, "skill", "name");
      return s ? `Skill ${s}` : tool;
    }
    default:
      return tool;
  }
}
