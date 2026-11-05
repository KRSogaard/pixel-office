import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  password?: string;
  ingestToken?: string;
  /** true/false forces the cookie's Secure flag; undefined = decide per request from x-forwarded-proto. */
  cookieSecure?: boolean;
  idleAfterMs: number;
  leaveAfterMs: number;
  recordPath?: string;
  webDir?: string;
  /** Use X-Forwarded-For / X-Forwarded-Proto (set when running behind a reverse proxy). */
  trustProxy: boolean;
}

function int(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined || v === "") return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

/** Finds the built web app: explicit env, then next to the bundle, then the monorepo layout. */
function findWebDir(explicit: string | undefined): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    resolve(here, "web"),
    resolve(here, "../web"),
    resolve(here, "../../web/dist"),
    resolve(process.cwd(), "web"),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(resolve(p, "index.html"))) ?? explicit;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cookieSecure = bool(env.PIXEL_OFFICE_COOKIE_SECURE);
  const webDir = findWebDir(env.PIXEL_OFFICE_WEB_DIR);
  return {
    port: int(env.PIXEL_OFFICE_PORT, 8790),
    host: env.PIXEL_OFFICE_HOST || "127.0.0.1",
    dataDir: resolve(env.PIXEL_OFFICE_DATA_DIR || "./data"),
    ...(env.PIXEL_OFFICE_PASSWORD ? { password: env.PIXEL_OFFICE_PASSWORD } : {}),
    ...(env.PIXEL_OFFICE_INGEST_TOKEN ? { ingestToken: env.PIXEL_OFFICE_INGEST_TOKEN } : {}),
    ...(cookieSecure !== undefined ? { cookieSecure } : {}),
    idleAfterMs: int(env.PIXEL_OFFICE_IDLE_AFTER_MS, 10 * 60_000),
    leaveAfterMs: int(env.PIXEL_OFFICE_LEAVE_AFTER_MS, 30 * 60_000),
    ...(env.PIXEL_OFFICE_RECORD ? { recordPath: resolve(env.PIXEL_OFFICE_RECORD) } : {}),
    ...(webDir ? { webDir } : {}),
    trustProxy: bool(env.PIXEL_OFFICE_TRUST_PROXY) ?? false,
  };
}
