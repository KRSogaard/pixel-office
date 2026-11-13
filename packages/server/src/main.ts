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
import { loadSecrets, rotateAdminToken } from "./secrets.js";
import { UserError, UsersStore } from "./users.js";
import { SettingsStore } from "./settings.js";
import { StatsTracker } from "./stats.js";
import { SCENARIOS } from "./simulator/scenarios.js";
import { simulateRecording, simulateScenario } from "./simulator/run.js";
import { webVersion } from "./version.js";
import { attachWebSocket } from "./ws.js";

const USAGE = `pixel-office — a pixel-art office for your coding agents

Usage:
  pixel-office serve                         Start the server (default)
  pixel-office simulate <scenario|file.jsonl> [--url URL] [--token T] [--speed N] [--loops N]
                                             Feed fake agents into a running server
                                             Scenarios: ${Object.keys(SCENARIOS).join(", ")}
  pixel-office token                         Print the shared ingest token
  pixel-office token --admin --rotate        Make a new admin token (the setup key) and print it once
  pixel-office user add <name> [--admin]     Add a person (a member, or an admin); prints their token once
  pixel-office user role <name> admin|member Make someone an admin or a member
  pixel-office user list                     List people
  pixel-office user remove <name>            Remove a person (their token stops working)
  pixel-office user token <name>             Give a person a new token (the old one stops working)
  pixel-office display add <name>            Add a TV / screen; prints its 6-letter code (abc-def)
  pixel-office display list                  List screens
  pixel-office display remove <name>         Remove a screen (it is logged out)
  pixel-office install-opencode              Install the OpenCode plugin into ~/.config/opencode/plugins

From a clone, run these in the repo folder as \`pnpm start <command>\`
(e.g. \`pnpm start user list\`). With Docker: \`docker compose exec pixel-office node server.js <command>\`.

Configuration is via PIXEL_OFFICE_* environment variables — see README.md.`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      speed: { type: "string" },
      loops: { type: "string" },
      admin: { type: "boolean" },
      rotate: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = "serve", arg, ...rest] = positionals;
  if (values.help) return void console.log(USAGE);

  switch (command) {
    case "serve":
      return runServe();
    case "simulate": {
      if (!arg) throw new Error(`simulate needs a scenario or a .jsonl file.\n\n${USAGE}`);
      const config = loadConfig();
      // The connectors' variables may list several offices; simulate into the first one.
      const first = (v: string | undefined) => v?.split(/[\s,]+/).find(Boolean);
      const token =
        values.token ?? first(process.env.PIXEL_OFFICE_TOKEN) ?? loadSecrets(config.dataDir, config).secrets.ingestToken;
      const opts = {
        url: values.url ?? first(process.env.PIXEL_OFFICE_URL) ?? `http://127.0.0.1:${config.port}`,
        token,
        speed: Number(values.speed ?? 1) || 1,
        ...(values.loops ? { loops: Number(values.loops) } : {}),
        log: (l: string) => console.log(l),
      };
      return arg.endsWith(".jsonl") ? simulateRecording(arg, opts) : simulateScenario(arg, opts);
    }
    case "token": {
      const config = loadConfig();
      if (values.admin) {
        if (!values.rotate) {
          throw new Error("The admin token is stored hashed and can't be shown again. Use `pixel-office token --admin --rotate` to make a new one.");
        }
        const token = rotateAdminToken(config.dataDir);
        return void console.log(`New admin token (shown once; restart the server to apply):\n  ${token}\n\nLog in with it, or open  /admin?token=${token}`);
      }
      return void console.log(loadSecrets(config.dataDir, config).secrets.ingestToken);
    }
    case "user":
    case "display":
      return manage(command, arg, rest.join(" "), !!values.admin);
    case "install-opencode":
      return installOpenCode();
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

/** `user add|list|remove` and `display add|list|remove`, straight on the data dir. */
function manage(kind: "user" | "display", action: string | undefined, name: string, admin = false): void {
  const config = loadConfig();
  const users = new UsersStore(config.dataDir);
  const need = () => {
    if (!name.trim()) throw new Error(`${kind} ${action} needs a name.\n\n${USAGE}`);
  };
  try {
    if (kind === "user" && action === "add") {
      need();
      const { user, token } = users.addUser(name, admin ? "admin" : "member");
      console.log(`Added ${user.name} as ${user.role === "admin" ? "an admin" : "a member"}. Their token (shown once):\n  ${token}\n`);
      console.log(`They log in to the office with their name ("${user.name}") and this token.`);
      console.log("In Claude Code: /plugin install pixel-office@pixel-office, then enter the server URL and this token.");
      console.log("Already installed? Change the token with /config (or /plugin) under pixel-office's settings.");
      console.log("OpenCode: export PIXEL_OFFICE_TOKEN=<this token> next to PIXEL_OFFICE_URL.");
      return;
    }
    if (kind === "user" && action === "list") {
      const list = users.listUsers();
      if (!list.length) return void console.log("No people yet. Add one with `pnpm start user add <name>` (or in 👥 People).");
      for (const u of list) console.log(`${u.name}\t${u.role}\tadded ${new Date(u.createdAt).toLocaleString()}\t${u.lastSeenAt ? `last seen ${new Date(u.lastSeenAt).toLocaleString()}` : "not seen yet"}`);
      return;
    }
    if (kind === "user" && action === "role") {
      // `user role <name> admin|member` — the role is the last word, the name is the rest.
      const words = name.trim().split(/\s+/);
      const role = words.pop();
      const who = words.join(" ");
      if (!who || (role !== "admin" && role !== "member")) throw new Error(`Usage: pixel-office user role <name> admin|member\n\n${USAGE}`);
      const id = users.findUserIdByName(who);
      if (!id) throw new Error(`No one called "${who}".`);
      users.setRole(id, role);
      return void console.log(`${who} is now ${role === "admin" ? "an admin" : "a member"}.`);
    }
    if (kind === "user" && action === "token") {
      need();
      const id = users.findUserIdByName(name);
      const token = id && users.regenerateUserToken(id);
      if (!token) throw new Error(`No one called "${name}".`);
      console.log(`New token for ${name} (shown once; the old one no longer works):\n  ${token}`);
      return;
    }
    if (kind === "user" && action === "remove") {
      need();
      if (!users.removeUserByName(name)) throw new Error(`No one called "${name}".`);
      return void console.log(`Removed ${name}. Their token no longer works.`);
    }
    if (kind === "display" && action === "add") {
      need();
      const { display, key } = users.addDisplay(name);
      console.log(`Added screen "${display.name}". Its TV code:\n\n    ${key}\n\nOn the screen, open the office and type the code in the "TV code" box (or go to /tv/${key}).`);
      return;
    }
    if (kind === "display" && action === "list") {
      const list = users.listDisplays();
      if (!list.length) return void console.log("No screens yet. Add one with `pnpm start display add <name>` (or in 👥 People).");
      for (const d of list) console.log(`${d.name}\tadded ${new Date(d.createdAt).toLocaleString()}`);
      return;
    }
    if (kind === "display" && action === "remove") {
      need();
      if (!users.removeDisplayByName(name)) throw new Error(`No screen called "${name}".`);
      return void console.log(`Removed screen "${name}". It is logged out.`);
    }
  } catch (err) {
    if (err instanceof UserError) throw new Error(err.message);
    throw err;
  }
  console.log(USAGE);
  process.exitCode = 1;
}

function runServe(): void {
  const config = loadConfig();
  const { secrets, generated } = loadSecrets(config.dataDir, config);
  const users = new UsersStore(config.dataDir);
  const stats = new StatsTracker({ dataDir: config.dataDir });
  const hub = new Hub({ recordPath: config.recordPath, historyMs: config.historyMs, stats });
  const settings = new SettingsStore(config.dataDir);
  const app = createApp({ config, secrets, hub, settings, stats, users, adapters: createAdapters() });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`pixel-office listening on http://${config.host}:${info.port}`);
    if (!config.webDir) console.log("  (web app not found — run `pnpm build` or set PIXEL_OFFICE_WEB_DIR)");
    if (config.recordPath) console.log(`  recording events to ${config.recordPath}`);
  }) as Server;
  attachWebSocket(server, hub, secrets, settings, stats, users, () => webVersion(config.webDir));
  startReaper(hub, config);

  if (generated.ingestToken || generated.adminToken) {
    const lines = ["", "  First run — generated credentials (shown once; saved in the data dir, admin token hashed):"];
    if (generated.ingestToken) lines.push(`    Shared ingest token : ${generated.ingestToken}`);
    if (generated.adminToken) {
      lines.push(`    Admin token         : ${generated.adminToken}`);
      lines.push(`      setup link        : http://${config.host}:${config.port}/admin?token=${generated.adminToken}`);
      lines.push("", "  Open the setup link, then in 👥 People add yourself as an admin. From then on everyone");
      lines.push("  logs in with their name and their own token; keep the admin token as the emergency key.");
    }
    lines.push("  Set PIXEL_OFFICE_INGEST_TOKEN / PIXEL_OFFICE_ADMIN_TOKEN to choose your own.", "");
    console.log(lines.join("\n"));
  }

  const shutdown = () => {
    stats.flush();
    users.flush();
    server.close(() => process.exit(0));
  };
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
  export PIXEL_OFFICE_TOKEN=<ingest token>   # from \`pixel-office token\` on the server

Several offices? List them, comma separated, with their tokens in the same order.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
