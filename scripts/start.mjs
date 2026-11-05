#!/usr/bin/env node
/**
 * `pnpm start`: rebuild first if the sources changed since the last build
 * (e.g. after a `git pull`), then run the server. Arguments are passed through.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => join(root, ...p);
const SERVER = at("packages", "server", "dist", "server.js");
const WEB = at("packages", "web", "dist", "index.html");

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** Newest modification time of any file under `dir`. */
function newest(dir) {
  let max = 0;
  if (!existsSync(dir)) return max;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    max = Math.max(max, entry.isDirectory() ? newest(p) : mtime(p));
  }
  return max;
}

function sourcesNewest() {
  let max = mtime(at("pnpm-lock.yaml"));
  for (const pkg of readdirSync(at("packages"))) {
    const dir = at("packages", pkg);
    max = Math.max(max, newest(join(dir, "src")), mtime(join(dir, "index.html")), mtime(join(dir, "package.json")));
  }
  return max;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const built = Math.min(mtime(SERVER), mtime(WEB));
if (!built || sourcesNewest() > built) {
  console.log("pixel-office: sources changed, rebuilding…");
  const installed = mtime(at("node_modules", ".modules.yaml"));
  if (!installed || mtime(at("pnpm-lock.yaml")) > installed) run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", ["-r", "build"]);
}

const child = spawn(process.execPath, [SERVER, ...process.argv.slice(2)], { cwd: root, stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
