import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Adapter } from "./adapters/index.js";
import type { Config } from "./config.js";
import type { Hub } from "./hub.js";
import { loginPage } from "./login-page.js";
import { safeEqual, signSession, verifyPassword, verifySession, type Secrets } from "./secrets.js";

export const SESSION_COOKIE = "po_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export interface AppDeps {
  config: Pick<Config, "cookieSecure" | "trustProxy" | "webDir">;
  secrets: Secrets;
  hub: Hub;
  adapters: Record<string, Adapter>;
  clock?: () => number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export function isAuthed(secrets: Secrets, cookieValue: string | undefined, now = Date.now()): boolean {
  return verifySession(secrets.sessionSecret, cookieValue, now);
}

export function createApp(deps: AppDeps): Hono {
  const { config, secrets, hub, adapters } = deps;
  const clock = deps.clock ?? Date.now;
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const app = new Hono();

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (xff) return xff;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
  const isHttps = (c: Context): boolean => {
    if (config.cookieSecure !== undefined) return config.cookieSecure;
    if (config.trustProxy && c.req.header("x-forwarded-proto") === "https") return true;
    return new URL(c.req.url).protocol === "https:";
  };
  const authed = (c: Context) => isAuthed(secrets, getCookie(c, SESSION_COOKIE), clock());

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Ingest. Always answers with an empty body: Claude Code must never receive text it could show the model.
  app.post(
    "/ingest/:source",
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.body(null, 413) }),
    async (c) => {
      const auth = c.req.header("authorization");
      const presented = auth?.startsWith("Bearer ") ? auth.slice(7) : c.req.header("x-po-token");
      if (!presented || !safeEqual(presented, secrets.ingestToken)) return c.body(null, 401);
      const adapter = adapters[c.req.param("source")];
      if (!adapter) return c.body(null, 404);
      let payload: unknown;
      try {
        payload = await c.req.json();
      } catch {
        return c.body(null, 400);
      }
      hub.apply(adapter.toEvents(payload, clock()));
      return c.body(null, 204);
    },
  );

  app.get("/login", (c) => (authed(c) ? c.redirect("/") : c.html(loginPage())));

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    const now = clock();
    let rec = attempts.get(ip);
    if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
      return c.html(loginPage("Too many attempts. Try again in a few minutes."), 429);
    }
    rec.count++;
    attempts.set(ip, rec);

    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const password = typeof form.password === "string" ? form.password : "";
    if (!password || !verifyPassword(password, secrets.passwordHash)) {
      return c.html(loginPage("Wrong password."), 401);
    }
    attempts.delete(ip);
    setCookie(c, SESSION_COOKIE, signSession(secrets.sessionSecret, now + SESSION_TTL_MS), {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
      secure: isHttps(c),
    });
    return c.redirect("/", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });

  app.get("/api/state", (c) => (authed(c) ? c.json(hub.snapshot) : c.body(null, 401)));

  // Built web app. The page itself requires login; assets are harmless without data.
  app.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    const wantsPage = path === "/" || path.endsWith(".html");
    if (wantsPage && !authed(c)) return c.redirect("/login");
    if (!config.webDir) return c.text("Web app not built. Run `pnpm build`.", 503);

    const file = await resolveStatic(config.webDir, path === "/" ? "/index.html" : path);
    if (!file) return c.notFound();
    const body = await readFile(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    c.header("Content-Type", type);
    c.header("Cache-Control", path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    return c.body(body);
  });

  return app;
}

async function resolveStatic(root: string, urlPath: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const base = resolve(root);
  const full = resolve(join(base, normalize(decoded)));
  if (full !== base && !full.startsWith(base + sep)) return undefined;
  try {
    const s = await stat(full);
    return s.isFile() ? full : undefined;
  } catch {
    return undefined;
  }
}
