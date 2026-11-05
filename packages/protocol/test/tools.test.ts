import { describe, expect, it } from "vitest";
import { categorizeTool, summarizeTool } from "../src/index.js";

describe("tools", () => {
  it("categorizes Claude Code and OpenCode tool names alike", () => {
    expect(categorizeTool("Edit")).toBe("edit");
    expect(categorizeTool("edit")).toBe("edit");
    expect(categorizeTool("Grep")).toBe("read");
    expect(categorizeTool("bash")).toBe("shell");
    expect(categorizeTool("WebSearch")).toBe("web");
    expect(categorizeTool("mcp__slack__send")).toBe("mcp");
    expect(categorizeTool("Agent")).toBe("delegate");
    expect(categorizeTool("task")).toBe("delegate");
    expect(categorizeTool("TodoWrite")).toBe("other");
  });

  it("summarizes without leaking large inputs", () => {
    expect(summarizeTool("Write", { file_path: "/a/b/app.ts", content: "x".repeat(10_000) })).toBe("Write app.ts");
    expect(summarizeTool("read", { filePath: "/a/b/c.ts" })).toBe("read c.ts");
    expect(summarizeTool("Bash", { command: "npm test", description: "Run tests" })).toBe("Bash: Run tests");
    expect(summarizeTool("WebFetch", { url: "https://example.com/x" })).toBe("Fetch example.com");
    expect(summarizeTool("mcp__github__create_pr", {})).toBe("github: create_pr");
    expect(summarizeTool("Agent", { description: "find usages" })).toBe("Delegate: find usages");
  });

  it("spots git work and shipping", async () => {
    const { isGitCommand, isShipCommand } = await import("../src/index.js");
    expect(isGitCommand("Bash", "Bash: git commit -m fix")).toBe(true);
    expect(isGitCommand("Bash", "Bash: gh pr create --fill")).toBe(true);
    expect(isGitCommand("Bash", "Bash: npm test")).toBe(false);
    expect(isGitCommand("Read", "git push")).toBe(false);
    expect(isShipCommand("Bash", "Bash: git push origin main")).toBe(true);
    expect(isShipCommand("Bash", "Bash: git commit -m x")).toBe(false);
  });

  it("never counts a git command as a test run", async () => {
    const { isTestRun } = await import("../src/index.js");
    expect(isTestRun("Bash", "Bash: git commit -am 'Fix flaky invoice tests'")).toBe(false);
    expect(isTestRun("Bash", "Bash: pnpm test invoices")).toBe(true);
    expect(isTestRun("Bash", "Bash: Run test suite")).toBe(true);
  });
});
