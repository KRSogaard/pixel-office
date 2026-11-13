import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The zero-token rule: the Claude Code hook must print nothing (stdout on
 * SessionStart/UserPromptSubmit enters the model's context) and never fail.
 */
const SCRIPT = resolve(__dirname, "../../../plugins/claude-code/hooks/po-hook.sh");
const payload = JSON.stringify({ session_id: "abc", cwd: "/x", hook_event_name: "UserPromptSubmit", prompt: "hi" });

function runHook(env: Record<string, string>, input = payload): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn("sh", [SCRIPT], { env: { PATH: process.env.PATH ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => done({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe("po-hook.sh", () => {
  let server: Server;
  let port = 0;
  const received: { auth?: string; context?: string; branch?: string; jobs?: string; body: string }[] = [];
  const paths: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        paths.push(req.url ?? "");
        const context = req.headers["x-po-context-tokens"];
        const branch = req.headers["x-po-git-branch"];
        const jobs = req.headers["x-po-jobs"];
        received.push({
          ...(typeof jobs === "string" ? { jobs } : {}),
          ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
          ...(typeof context === "string" ? { context } : {}),
          ...(typeof branch === "string" ? { branch } : {}),
          body,
        });
        // A hostile/buggy server reply must still not reach stdout.
        res.writeHead(200, { "content-type": "text/plain" }).end("SHOULD NOT APPEAR");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("on Stop, reports the background commands the transcript says have finished", async () => {
    const dir = mkdtempSync(join(tmpdir(), "po-hook-"));
    const transcript = join(dir, "t.jsonl");
    const note = (task: string, call: string, status: string) =>
      JSON.stringify({ type: "queue-operation", content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${call}</tool-use-id>\n<output-file>/tmp/x/${task}.output</output-file>\n<status>${status}</status>\n<summary>Background command "Run tests" completed (exit code 0)</summary>\n</task-notification>` });
    writeFileSync(transcript, [note("b1", "toolu_01AAA", "completed"), note("b2", "toolu_01BBB", "failed"), note("b1", "toolu_01AAA", "completed")].join("\n") + "\n");
    const stop = JSON.stringify({ session_id: "abc", cwd: "/x", hook_event_name: "Stop", transcript_path: transcript });
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok", TMPDIR: join(dir, "elsewhere") }, stop);
    expect(r.stdout).toBe("");
    expect(received.at(-1)?.jobs).toBe("toolu_01AAA:completed,toolu_01BBB:failed");

    // The next turn ends: only what finished since then is reported.
    writeFileSync(transcript, note("b3", "toolu_01CCC", "completed") + "\n", { flag: "a" });
    await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok", TMPDIR: dir }, stop);
    await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok", TMPDIR: dir }, stop);
    expect(received.at(-1)?.jobs).toBeUndefined();
    expect(received.at(-2)?.jobs).toBe("toolu_01AAA:completed,toolu_01BBB:failed,toolu_01CCC:completed");
  });

  it("forwards the payload with the token and prints nothing", async () => {
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}/`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(received.at(-1)).toEqual({ auth: "Bearer tok", body: payload });
  });

  it("sends the git branch of the session's folder on prompts, still silently", async () => {
    const repo = mkdtempSync(join(tmpdir(), "po-git-"));
    const git = (...args: string[]) =>
      new Promise<void>((r) => spawn("git", ["-C", repo, ...args], { stdio: "ignore" }).on("close", () => r()));
    await git("init", "-q", "-b", "feature/office");
    const input = JSON.stringify({ session_id: "abc", cwd: repo, hook_event_name: "UserPromptSubmit", prompt: "hi" });
    const r = await runHook({ PIXEL_OFFICE_URL: `http://127.0.0.1:${port}`, PIXEL_OFFICE_TOKEN: "t" }, input);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(received.at(-1)?.branch).toBe("feature/office");
  });

  it("sends to every office in the list, each with its own token", async () => {
    const before = received.length;
    const office = (name: string) => `http://127.0.0.1:${port}/${name}`;
    const r = await runHook({
      CLAUDE_PLUGIN_OPTION_SERVER_URL: `${office("home")}, ${office("work")}/ http://127.0.0.1:1`,
      CLAUDE_PLUGIN_OPTION_TOKEN: "tok-home,tok-work tok-dead",
    });
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    const sent = paths.slice(before).map((p, i) => `${p} ${received[before + i]?.auth}`).sort();
    expect(sent).toEqual(["/home/ingest/claude Bearer tok-home", "/work/ingest/claude Bearer tok-work"]);
  });

  it("uses a single token for every office", async () => {
    const before = received.length;
    await runHook({ PIXEL_OFFICE_URL: `http://127.0.0.1:${port}/a,http://127.0.0.1:${port}/b`, PIXEL_OFFICE_TOKEN: "same" });
    expect(received.slice(before).map((x) => x.auth)).toEqual(["Bearer same", "Bearer same"]);
  });

  it("is silent and exits 0 when the server is unreachable", async () => {
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: "http://127.0.0.1:1", CLAUDE_PLUGIN_OPTION_TOKEN: "tok" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("is a silent no-op when not configured", async () => {
    const r = await runHook({});
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("sends context use from the transcript's last usage, still silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "po-transcript-"));
    const transcript = join(dir, "t.jsonl");
    const line = (usage: object) => JSON.stringify({ type: "assistant", message: { role: "assistant", usage, content: [] } });
    writeFileSync(
      transcript,
      [
        line({ input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 9 }),
        JSON.stringify({ type: "user", message: { content: "tool result" } }),
        line({
          input_tokens: 120,
          cache_creation_input_tokens: 3000,
          cache_read_input_tokens: 45000,
          cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 0 },
          output_tokens: 400,
        }),
      ].join("\n") + "\n",
    );
    const input = JSON.stringify({ session_id: "abc", cwd: "/x", hook_event_name: "PostToolUse", transcript_path: transcript, tool_name: "Read" });
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok" }, input);
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(received.at(-1)).toEqual({ auth: "Bearer tok", context: "48120", body: input });
  });

  it("sends no context header when the transcript is missing", async () => {
    const input = JSON.stringify({ session_id: "abc", cwd: "/x", hook_event_name: "Stop", transcript_path: "/nope/missing.jsonl" });
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok" }, input);
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(received.at(-1)).toEqual({ auth: "Bearer tok", body: input });
  });
});


describe("po-status.sh", () => {
  const STATUS = resolve(__dirname, "../../../plugins/claude-code/hooks/po-status.sh");
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "";
      const json = (status: number, body: object) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (path === "/home/ingest/check") return req.headers.authorization === "Bearer good" ? json(200, { ok: true, name: 'Kas"per\\' }) : json(401, { ok: false });
      if (path === "/old/health") return json(200, { ok: true });
      res.writeHead(404).end("not here");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  const run = (env: Record<string, string>) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
      const child = spawn("sh", [STATUS], { env: { PATH: process.env.PATH ?? "", ...env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("close", (status) => done({ status, stdout, stderr }));
      child.stdin.end(JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }));
    });

  it("prints only a systemMessage (shown to you, never to the model) with each office's status, in order", async () => {
    const host = new URL(base).host;
    const r = await run({
      CLAUDE_PLUGIN_OPTION_SERVER_URL: `${base}/home, ${base}/home/ ${base}/old,${base}/wrong http://127.0.0.1:1`,
      CLAUDE_PLUGIN_OPTION_TOKEN: "good, bad, good, good, good",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(Object.keys(JSON.parse(r.stdout))).toEqual(["systemMessage"]);
    expect(JSON.parse(r.stdout).systemMessage.split("\n")).toEqual([
      "pixel-office",
      `  ${host} ✓ connected as Kas"per\\`,
      `  ${host} ✗ token rejected`,
      `  ${host} ✓ reachable (older server: update it to check the token)`,
      `  ${host} ✗ not a pixel-office server (check the URL)`,
      "  127.0.0.1:1 ✗ can't reach the server",
    ]);
  });

  it("prints nothing when no office is set up", async () => {
    expect(await run({})).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});
