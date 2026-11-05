import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { SCENARIOS, type SimEvent, type Step } from "./scenarios.js";

export interface SimulateOptions {
  url: string;
  token: string;
  speed: number;
  /** Stop after this many passes (default: forever). */
  loops?: number;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(opts: SimulateOptions, events: SimEvent[]): Promise<void> {
  const res = await fetch(`${opts.url.replace(/\/$/, "")}/ingest/generic`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(events.map((e) => ({ ...e, ts: Date.now() }))),
  });
  if (res.status === 401) throw new Error("Server rejected the token (401). Pass --token or set PIXEL_OFFICE_TOKEN.");
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
}

async function play(steps: Step[], opts: SimulateOptions): Promise<void> {
  for (const step of steps) {
    if (step.delay > 0) await sleep(step.delay / opts.speed);
    await post(opts, [step.event]);
    opts.log?.(`${step.event.agentId.padEnd(28)} ${step.event.kind}`);
  }
}

export async function simulateScenario(name: string, opts: SimulateOptions): Promise<void> {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario "${name}". Try: ${Object.keys(SCENARIOS).join(", ")}`);
  for (let loop = 0; opts.loops === undefined || loop < opts.loops; loop++) {
    await play(scenario(loop), opts);
    await sleep(2000 / opts.speed);
  }
}

/** Replays a JSONL recording (from PIXEL_OFFICE_RECORD), keeping the original gaps between events. */
export async function simulateRecording(path: string, opts: SimulateOptions): Promise<void> {
  const steps: Step[] = [];
  let prevTs: number | undefined;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const { ts, ...event } = JSON.parse(line) as SimEvent & { ts: number };
    steps.push({ delay: prevTs === undefined ? 0 : Math.max(0, ts - prevTs), event: event as SimEvent });
    prevTs = ts;
  }
  for (let loop = 0; opts.loops === undefined || loop < opts.loops; loop++) {
    await play(steps, opts);
    if (opts.loops === undefined) await sleep(3000 / opts.speed);
  }
}
