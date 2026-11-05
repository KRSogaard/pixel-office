import { categorizeTool, detailTool, summarizeTool, type AgentEventInput } from "@pixel-office/protocol";

type Omit2<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SimEvent = Omit2<AgentEventInput, "ts">;
/** Wait `delay` ms (at speed 1), then send `event`. */
export interface Step {
  delay: number;
  event: SimEvent;
}
/** Builds one pass of a scenario. `loop` makes ids unique per pass. */
export type Scenario = (loop: number) => Step[];

interface Who {
  source: "claude" | "opencode";
  agentId: string;
  sessionId: string;
  parentAgentId?: string;
  label?: string;
  project: { path: string; name: string };
}

const proj = (name: string) => ({ path: `/Users/dev/code/${name}`, name });

function agent(source: Who["source"], id: string, project: string, extra: Partial<Who> = {}): Who {
  return { source, agentId: `${source}:${id}`, sessionId: `${source}:${id}`, project: proj(project), ...extra };
}

function child(parent: Who, id: string, label: string): Who {
  return { ...parent, agentId: `${parent.source}:${id}`, parentAgentId: parent.agentId, label };
}

/** A small script builder: each call appends a step after `delay` ms. */
class Script {
  readonly steps: Step[] = [];
  private n = 0;
  constructor(private readonly loop: number) {}

  at(delay: number, event: SimEvent): this {
    this.steps.push({ delay, event });
    return this;
  }
  start(w: Who, d = 300) {
    return this.at(d, { ...w, kind: "session.start" });
  }
  end(w: Who, d = 300, report?: string) {
    return this.at(d, { ...w, kind: "session.end", ok: true, ...(report ? { report } : {}) });
  }
  prompt(w: Who, text: string, d = 800) {
    return this.at(d, { ...w, kind: "prompt", text });
  }
  idle(w: Who, d = 600) {
    return this.at(d, { ...w, kind: "idle" });
  }
  wait(w: Who, reason: "permission" | "question", text: string, d = 600) {
    return this.at(d, { ...w, kind: "waiting", reason, text });
  }
  say(w: Who, to: string, text: string, d = 600) {
    return this.at(d, { ...w, kind: "message", to, text });
  }
  /** A tool call that starts after `d` and ends `dur` ms later. */
  tool(w: Who, tool: string, input: Record<string, unknown>, dur = 1500, d = 400, ok = true) {
    const callId = `sim-${this.loop}-${++this.n}`;
    this.at(d, {
      ...w,
      kind: "tool.start",
      callId,
      tool,
      category: categorizeTool(tool),
      summary: summarizeTool(tool, input),
    });
    return this.at(dur, { ...w, kind: "tool.end", callId, ok });
  }
  /** Start a tool call without ending it; returns its id. */
  open(w: Who, tool: string, input: Record<string, unknown>, d = 400): string {
    const callId = `sim-${this.loop}-${++this.n}`;
    const detail = detailTool(tool, input);
    this.at(d, {
      ...w,
      kind: "tool.start",
      callId,
      tool,
      category: categorizeTool(tool),
      summary: summarizeTool(tool, input),
      ...(detail ? { detail } : {}),
    });
    return callId;
  }
  close(w: Who, callId: string, d = 400, ok = true) {
    return this.at(d, { ...w, kind: "tool.end", callId, ok });
  }
}

/** Interleaves several scripts by absolute time so agents act in parallel. */
function merge(...scripts: Script[]): Step[] {
  const timed: { t: number; event: SimEvent; order: number }[] = [];
  let order = 0;
  for (const s of scripts) {
    let t = 0;
    for (const step of s.steps) {
      t += step.delay;
      timed.push({ t, event: step.event, order: order++ });
    }
  }
  timed.sort((a, b) => a.t - b.t || a.order - b.order);
  let prev = 0;
  return timed.map(({ t, event }) => {
    const delay = t - prev;
    prev = t;
    return { delay, event };
  });
}

const busyDay: Scenario = (loop) => {
  const mira = agent("claude", `mira-${loop}`, "magicdoor-api");
  const kai = agent("claude", `kai-${loop}`, "magicdoor-api");
  const otto = agent("opencode", `otto-${loop}`, "pixel-office");
  const wren = agent("claude", `wren-${loop}`, "pixel-office");
  const sol = agent("opencode", `sol-${loop}`, "website");

  const a = new Script(loop).start(mira).prompt(mira, "Add pagination to the leases endpoint");
  a.tool(mira, "Grep", { pattern: "LeaseController" }, 900)
    .tool(mira, "Read", { file_path: "src/Leases/LeaseController.cs" }, 1200)
    .tool(mira, "Read", { file_path: "src/Leases/LeaseQuery.cs" }, 900, 200)
    .tool(mira, "Edit", { file_path: "src/Leases/LeaseQuery.cs" }, 3500)
    .tool(mira, "Bash", { command: "dotnet test", description: "Run the test suite" }, 6000)
    .tool(mira, "Edit", { file_path: "src/Leases/LeaseController.cs" }, 2500)
    .idle(mira, 1500);

  const b = new Script(loop).start(kai, 4000).prompt(kai, "Why is the nightly invoice job slow?");
  b.tool(kai, "mcp__grafana__query_loki_logs", {}, 4000)
    .tool(kai, "Read", { file_path: "src/Jobs/InvoiceJob.cs" }, 1500)
    .tool(kai, "WebSearch", { query: "EF Core N+1 Include performance" }, 3500)
    .wait(kai, "permission", "Bash: psql -c 'EXPLAIN ANALYZE …'", 800)
    .tool(kai, "Bash", { command: "psql -c 'EXPLAIN ANALYZE …'" }, 3000, 7000)
    .idle(kai, 1200);

  const c = new Script(loop).start(otto, 1500).prompt(otto, "Draw the server room tiles");
  c.tool(otto, "read", { filePath: "packages/web/src/art/tiles.ts" }, 1200)
    .tool(otto, "edit", { filePath: "packages/web/src/art/tiles.ts" }, 5000)
    .tool(otto, "bash", { command: "pnpm build" }, 4000, 300, false)
    .tool(otto, "edit", { filePath: "packages/web/src/art/tiles.ts" }, 2500)
    .tool(otto, "bash", { command: "pnpm build" }, 3000)
    .idle(otto, 800);

  const d = new Script(loop).start(wren, 9000).prompt(wren, "Review the reducer tests");
  d.tool(wren, "Glob", { pattern: "**/*.test.ts" }, 700)
    .tool(wren, "Read", { file_path: "packages/protocol/test/reducer.test.ts" }, 2500)
    .tool(wren, "WebFetch", { url: "https://vitest.dev/api/" }, 3000)
    .wait(wren, "question", "Should I also cover the reaper?", 1000)
    .prompt(wren, "Yes please", 6000)
    .tool(wren, "Write", { file_path: "packages/server/test/reaper.test.ts" }, 3500)
    .idle(wren, 1000);

  const e = new Script(loop).start(sol, 6000).prompt(sol, "Update the pricing page copy");
  e.tool(sol, "read", { filePath: "src/pages/pricing.astro" }, 1500)
    .tool(sol, "websearch", { query: "saas pricing page examples" }, 3000)
    .tool(sol, "edit", { filePath: "src/pages/pricing.astro" }, 4000)
    // Hits the rate limit: coffee break.
    .at(800, { ...sol, kind: "error", text: "rate_limit" })
    .prompt(sol, "Try again please", 9000)
    .tool(sol, "edit", { filePath: "src/pages/pricing.astro" }, 2500)
    .idle(sol, 900);

  // Everyone goes home, so the next pass starts with an empty office.
  const tail = new Script(loop + 1)
    .end(otto, 55_000)
    .end(sol, 500)
    .end(mira, 500)
    .end(kai, 500)
    .end(wren, 500)
    .at(5000, { ...wren, kind: "session.end", ok: true });
  return merge(a, b, c, d, e, tail);
};

const delegationTree: Scenario = (loop) => {
  const lead = agent("claude", `lead-${loop}`, "magicdoor-web");
  const kids = [
    child(lead, `explore-${loop}`, "Explore"),
    child(lead, `review-${loop}`, "code-reviewer"),
    child(lead, `test-${loop}`, "test-writer"),
  ] as const;
  const s = new Script(loop).start(lead).prompt(lead, "Refactor the tenant portal auth flow");
  const plan = (statuses: ("pending" | "in_progress" | "completed")[]) =>
    ["Map every auth call site", "Review the session module", "Write token refresh tests", "Move tokens to httpOnly cookies", "Run the full test suite"].map(
      (text, i) => ({ text, status: statuses[i] ?? "pending" }),
    );
  s.at(600, { ...lead, kind: "todos", items: plan(["in_progress", "in_progress", "in_progress"]) });
  s.at(100, { ...lead, kind: "context", tokens: 38_000 });
  s.tool(lead, "Read", { file_path: "src/auth/session.ts" }, 1500);
  const calls = [
    s.open(lead, "Agent", { description: "map every auth call site", prompt: "Find every place the tenant portal reads or writes the auth token and list the files with line numbers", subagent_type: "Explore" }, 800),
    s.open(lead, "Agent", { description: "review the session module", prompt: "Review src/session for token-expiry bugs and anything that would break if tokens move to httpOnly cookies", subagent_type: "code-reviewer" }, 300),
    s.open(lead, "Agent", { description: "write tests for token refresh", prompt: "Write unit tests covering token refresh: expired token, refresh failure, concurrent refreshes", subagent_type: "test-writer" }, 300),
  ];
  for (const k of kids) s.start(k, 400);
  const work = [
    new Script(loop + 100).at(s.steps.reduce((t, x) => t + x.delay, 0), { ...kids[0], kind: "busy" }),
    new Script(loop + 200).at(s.steps.reduce((t, x) => t + x.delay, 0), { ...kids[1], kind: "busy" }),
    new Script(loop + 300).at(s.steps.reduce((t, x) => t + x.delay, 0), { ...kids[2], kind: "busy" }),
  ] as const;
  work[0].tool(kids[0], "Grep", { pattern: "useSession" }, 2000).tool(kids[0], "Read", { file_path: "src/auth/hooks.ts" }, 2500)
    .tool(kids[0], "Glob", { pattern: "src/**/auth*" }, 1200).end(kids[0], 1500, "Found 14 call sites in 6 files");
  work[1].tool(kids[1], "Read", { file_path: "src/auth/session.ts" }, 4000).tool(kids[1], "Grep", { pattern: "localStorage" }, 1500)
    .end(kids[1], 2500, "Tokens live in localStorage — move to httpOnly cookie");
  work[2].tool(kids[2], "Read", { file_path: "src/auth/refresh.ts" }, 2000).tool(kids[2], "Write", { file_path: "src/auth/refresh.test.ts" }, 5000)
    .tool(kids[2], "Bash", { command: "pnpm vitest run refresh" }, 4000).end(kids[2], 1000, "Added 7 tests, all green");

  const after = new Script(loop + 400).at(s.steps.reduce((t, x) => t + x.delay, 0) + 17_000, { ...lead, kind: "busy" });
  for (const c of calls) after.close(lead, c, 200);
  after.at(300, { ...lead, kind: "todos", items: plan(["completed", "completed", "completed", "in_progress"]) });
  after.at(100, { ...lead, kind: "context", tokens: 171_000 });
  // Context nearly full: compact (stomp the bin), then carry on lighter.
  after.at(1500, { ...lead, kind: "compact" }).at(3500, { ...lead, kind: "context", tokens: 41_000 });
  after.tool(lead, "Edit", { file_path: "src/auth/session.ts" }, 1500);
  after.at(200, { ...lead, kind: "todos", items: plan(["completed", "completed", "completed", "completed", "in_progress"]) });
  after.tool(lead, "Bash", { command: "pnpm test" }, 4000)
    .at(200, { ...lead, kind: "todos", items: plan(["completed", "completed", "completed", "completed", "completed"]) })
    .idle(lead, 1000).end(lead, 12000);
  return merge(s, ...work, after);
};

const permissionStorm: Scenario = (loop) => {
  const names = ["ada", "ben", "cleo", "dev"];
  const scripts = names.map((n, i) => {
    const w = agent(i % 2 ? "opencode" : "claude", `${n}-${loop}`, i < 2 ? "infra" : "billing");
    return new Script(loop * 10 + i)
      .start(w, 500 + i * 700)
      .prompt(w, "Clean up old deploy artifacts")
      .tool(w, "Bash", { command: "ls -la dist" }, 1200)
      .wait(w, "permission", ["Bash: rm -rf dist", "Bash: docker system prune", "Write .env", "Bash: git push --force"][i]!, 600)
      .tool(w, "Bash", { command: "rm -rf dist" }, 2000, 6000 + i * 2500)
      .idle(w, 800)
      .end(w, 5000);
  });
  return merge(...scripts);
};

const twoTools: Scenario = (loop) => {
  const c = agent("claude", `c-${loop}`, "pixel-office");
  const o = agent("opencode", `o-${loop}`, "pixel-office");
  const a = new Script(loop).start(c).prompt(c, "Write the Claude adapter")
    .tool(c, "Read", { file_path: "packages/server/src/adapters/claude.ts" }, 1500)
    .tool(c, "Edit", { file_path: "packages/server/src/adapters/claude.ts" }, 5000)
    .tool(c, "Bash", { command: "pnpm test" }, 3500).idle(c, 800).end(c, 8000);
  const b = new Script(loop + 1).start(o, 1200).prompt(o, "Write the OpenCode adapter")
    .tool(o, "read", { filePath: "packages/server/src/adapters/opencode.ts" }, 2000)
    .tool(o, "edit", { filePath: "packages/server/src/adapters/opencode.ts" }, 6000)
    .tool(o, "bash", { command: "pnpm test" }, 3000).idle(o, 800).end(o, 6000);
  return merge(a, b);
};

const team: Scenario = (loop) => {
  const lead = agent("claude", `team-lead-${loop}`, "magicdoor-api");
  const res = child(lead, `researcher-${loop}`, "researcher");
  const impl = child(lead, `implementer-${loop}`, "implementer");
  const s = new Script(loop).start(lead).prompt(lead, "Ship webhook retries");
  const c1 = s.open(lead, "Agent", { description: "research retry strategies", prompt: "Compare exponential backoff, jitter and dead-letter queues for webhook retries and recommend one", subagent_type: "researcher" }, 600);
  const c2 = s.open(lead, "Agent", { description: "implement the retry queue", prompt: "Implement a retry queue for failed webhooks using the strategy the researcher recommends", subagent_type: "implementer" }, 300);
  s.start(res, 300).start(impl, 300);
  s.tool(res, "WebSearch", { query: "webhook retry exponential backoff" }, 3000)
    .tool(res, "SendMessage", { to: "implementer", message: "Use exponential backoff, cap at 6 tries" }, 600)
    .say(res, "implementer", "Use exponential backoff, cap at 6 tries", 0)
    .tool(impl, "Read", { file_path: "src/Webhooks/Dispatcher.cs" }, 2000)
    .tool(impl, "SendMessage", { to: "researcher", message: "Jitter too?" }, 600)
    .say(impl, "researcher", "Jitter too?", 0)
    .say(res, "implementer", "Yes — full jitter", 1500)
    .tool(impl, "Edit", { file_path: "src/Webhooks/RetryQueue.cs" }, 5000)
    .say(impl, lead.agentId, "Retry queue done, PR ready", 800)
    .end(res, 800, "Backoff + full jitter, 6 tries")
    .end(impl, 600, "RetryQueue.cs implemented and tested")
    .close(lead, c1, 300)
    .close(lead, c2, 100)
    .tool(lead, "Bash", { command: "gh pr create" }, 2500)
    .idle(lead, 800)
    .end(lead, 8000);
  return s.steps;
};

/**
 * Every gag in the office, in a couple of minutes: failing tests (fire), a
 * passing run (confetti), commit + push (rocket launch), a README (printer),
 * a scary command (sweat), a Slack call (courier), a sub-agent that fails
 * (medics), and a long think (rubber duck).
 */
const fun: Scenario = (loop) => {
  const ana = agent("claude", `ana-${loop}`, "magicdoor-api");
  const a = new Script(loop).start(ana).prompt(ana, "Fix the flaky invoice tests");
  a.tool(ana, "Bash", { command: "pnpm test invoices" }, 3000, 1500, false)
    .tool(ana, "Edit", { file_path: "src/invoices/schedule.ts" }, 2500)
    .tool(ana, "Bash", { command: "pnpm test invoices" }, 3000, 600, false)
    .tool(ana, "Edit", { file_path: "src/invoices/schedule.ts" }, 2500)
    .tool(ana, "Bash", { command: "pnpm test invoices" }, 3000)
    .tool(ana, "Write", { file_path: "docs/README.md" }, 2000)
    .tool(ana, "Bash", { command: "git commit -am 'Fix flaky invoice tests'" }, 1500)
    .tool(ana, "Bash", { command: "git push origin fix/invoices" }, 2500)
    .idle(ana, 1500)
    .end(ana, 20_000);

  const ops = agent("opencode", `ops-${loop}`, "infra");
  const b = new Script(loop + 1).start(ops, 4000).prompt(ops, "Clean up the staging cluster");
  b.tool(ops, "bash", { command: "kubectl get pods -n staging" }, 2000)
    .tool(ops, "bash", { command: "rm -rf ./tmp/cache" }, 2500, 1200)
    .tool(ops, "mcp__slack__post_message", { channel: "#ops" }, 3500, 1500)
    .idle(ops, 1000)
    .end(ops, 25_000);

  const lead = agent("claude", `lead-${loop}`, "website");
  const helper = child(lead, `helper-${loop}`, "Explore");
  const c = new Script(loop + 2).start(lead, 2000).prompt(lead, "Find out why the pricing page 404s");
  const call = c.open(lead, "Agent", { description: "find the routing config", prompt: "Find where the pricing route is configured", subagent_type: "Explore" }, 1500);
  c.start(helper, 300)
    .tool(helper, "Grep", { pattern: "pricing" }, 2500)
    .tool(helper, "Read", { file_path: "src/routes.ts" }, 2500)
    .at(800, { ...helper, kind: "session.end", ok: false, report: "Couldn't find the routing config" })
    .close(lead, call, 600, false)
    // A long, quiet think: out comes the rubber duck.
    .at(500, { ...lead, kind: "busy" })
    .at(26_000, { ...lead, kind: "tool.start", callId: `fun-${loop}-r`, tool: "Read", category: "read", summary: "Read astro.config.mjs" })
    .at(2000, { ...lead, kind: "tool.end", callId: `fun-${loop}-r`, ok: true })
    .idle(lead, 1000)
    .end(lead, 12_000);
  return merge(a, b, c);
};

export const SCENARIOS: Record<string, Scenario> = {
  fun,
  "busy-day": busyDay,
  "delegation-tree": delegationTree,
  "permission-storm": permissionStorm,
  "two-tools": twoTools,
  team,
};
