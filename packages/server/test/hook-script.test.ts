import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The zero-token rule: the Claude Code hook must print nothing (stdout on
 * SessionStart/UserPromptSubmit enters the model's context) and never fail.
 */
const SCRIPT = resolve(__dirname, "../../../plugins/claude-code/hooks/po-hook.sh");
const payload = JSON.stringify({ session_id: "abc", cwd: "/x", hook_event_name: "UserPromptSubmit", prompt: "hi" });

function runHook(env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn("sh", [SCRIPT], { env: { PATH: process.env.PATH ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => done({ status, stdout, stderr }));
    child.stdin.end(payload);
  });
}

describe("po-hook.sh", () => {
  let server: Server;
  let port = 0;
  const received: { auth?: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ ...(req.headers.authorization ? { auth: req.headers.authorization } : {}), body });
        // A hostile/buggy server reply must still not reach stdout.
        res.writeHead(200, { "content-type": "text/plain" }).end("SHOULD NOT APPEAR");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("forwards the payload with the token and prints nothing", async () => {
    const r = await runHook({ CLAUDE_PLUGIN_OPTION_SERVER_URL: `http://127.0.0.1:${port}/`, CLAUDE_PLUGIN_OPTION_TOKEN: "tok" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(received.at(-1)).toEqual({ auth: "Bearer tok", body: payload });
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
});
