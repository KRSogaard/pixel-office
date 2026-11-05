import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createAdapters } from "./adapters/index.js";
import { loadConfig } from "./config.js";
import { createApp } from "./http.js";
import { Hub } from "./hub.js";
import { startReaper } from "./reaper.js";
import { loadSecrets } from "./secrets.js";
import { SCENARIOS } from "./simulator/scenarios.js";
import { simulateRecording, simulateScenario } from "./simulator/run.js";
import { attachWebSocket } from "./ws.js";

const USAGE = `pixel-office — a pixel-art office for your coding agents

Usage:
  pixel-office serve                         Start the server (default)
  pixel-office simulate <scenario|file.jsonl> [--url URL] [--token T] [--speed N] [--loops N]
                                             Feed fake agents into a running server
                                             Scenarios: ${Object.keys(SCENARIOS).join(", ")}
  pixel-office token                         Print the ingest token
  pixel-office install-opencode              Install the OpenCode plugin into ~/.config/opencode/plugins

Configuration is via PIXEL_OFFICE_* environment variables — see README.md.`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      speed: { type: "string" },
      loops: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = "serve", arg] = positionals;
  if (values.help) return void console.log(USAGE);

  switch (command) {
    case "serve":
      return runServe();
    case "simulate": {
      if (!arg) throw new Error(`simulate needs a scenario or a .jsonl file.\n\n${USAGE}`);
      const config = loadConfig();
      const token =
        values.token ?? process.env.PIXEL_OFFICE_TOKEN ?? loadSecrets(config.dataDir, config).secrets.ingestToken;
      const opts = {
        url: values.url ?? process.env.PIXEL_OFFICE_URL ?? `http://127.0.0.1:${config.port}`,
        token,
        speed: Number(values.speed ?? 1) || 1,
        ...(values.loops ? { loops: Number(values.loops) } : {}),
        log: (l: string) => console.log(l),
      };
      return arg.endsWith(".jsonl") ? simulateRecording(arg, opts) : simulateScenario(arg, opts);
    }
    case "token": {
      const config = loadConfig();
      return void console.log(loadSecrets(config.dataDir, config).secrets.ingestToken);
    }
    case "install-opencode":
      return installOpenCode();
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

function runServe(): void {
  const config = loadConfig();
  const { secrets, generated } = loadSecrets(config.dataDir, config);
  const hub = new Hub(config.recordPath);
  const app = createApp({ config, secrets, hub, adapters: createAdapters() });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`pixel-office listening on http://${config.host}:${info.port}`);
    if (!config.webDir) console.log("  (web app not found — run `pnpm build` or set PIXEL_OFFICE_WEB_DIR)");
    if (config.recordPath) console.log(`  recording events to ${config.recordPath}`);
  }) as Server;
  attachWebSocket(server, hub, secrets);
  startReaper(hub, config);

  if (generated.password || generated.ingestToken) {
    const lines = ["", "  First run — generated credentials (shown once; saved in the data dir, password hashed):"];
    if (generated.password) lines.push(`    Web login password : ${generated.password}`);
    if (generated.ingestToken) lines.push(`    Ingest token       : ${generated.ingestToken}`);
    lines.push("  Set PIXEL_OFFICE_PASSWORD / PIXEL_OFFICE_INGEST_TOKEN to choose your own.", "");
    console.log(lines.join("\n"));
  }

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function installOpenCode(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../plugins/opencode/pixel-office.ts"),
    resolve(here, "plugins/opencode/pixel-office.ts"),
    resolve(here, "../plugins/opencode/pixel-office.ts"),
    resolve(process.cwd(), "plugins/opencode/pixel-office.ts"),
  ];
  const src = candidates.find((p) => existsSync(p));
  if (!src) throw new Error("Could not find plugins/opencode/pixel-office.ts — run this from the pixel-office repo.");
  const dir = join(homedir(), ".config", "opencode", "plugins");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "pixel-office.ts");
  copyFileSync(src, dest);
  console.log(`Installed ${dest}

Now tell OpenCode where your office is (e.g. in ~/.zshrc):
  export PIXEL_OFFICE_URL=https://office.example.com
  export PIXEL_OFFICE_TOKEN=<ingest token>   # from \`pixel-office token\` on the server`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
