import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Adapter } from "./adapters/index.js";
import type { Config } from "./config.js";
import type { Hub } from "./hub.js";
import type { SettingsStore } from "./settings.js";
import { UserError, type UsersStore } from "./users.js";
import type { AgentEvent } from "@pixel-office/protocol";
import { emptyStats, type StatsTracker } from "./stats.js";
import { loginPage } from "./login-page.js";
import { isAdminToken, readSession, safeEqual, signSession, verifyPassword, type Secrets, type Session } from "./secrets.js";

export const SESSION_COOKIE = "po_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A TV stays logged in for a year. */
const VIEWER_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export interface AppDeps {
  config: Pick<Config, "cookieSecure" | "trustProxy" | "webDir">;
  secrets: Secrets;
  hub: Hub;
  settings: SettingsStore;
  stats?: StatsTracker;
  /** People (per-person ingest tokens) and display links. Optional for older callers. */
  users?: UsersStore;
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

/**
 * The session behind a cookie: admin (password / admin token) or viewer (a TV
 * opened with a display link). A viewer whose display link was revoked is out.
 */
export function sessionFrom(
  secrets: Secrets,
  cookieValue: string | undefined,
  now = Date.now(),
  users?: UsersStore,
): Session | undefined {
  const s = readSession(secrets.sessionSecret, cookieValue, now);
  if (s?.role === "viewer" && !(s.displayId && users?.hasDisplay(s.displayId))) return undefined;
  return s;
}

export function isAuthed(secrets: Secrets, cookieValue: string | undefined, now = Date.now(), users?: UsersStore): boolean {
  return sessionFrom(secrets, cookieValue, now, users) !== undefined;
}

export function createApp(deps: AppDeps): Hono {
  const { config, secrets, hub, adapters, settings } = deps;
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
  const users = deps.users;
  const session = (c: Context) => sessionFrom(secrets, getCookie(c, SESSION_COOKIE), clock(), users);
  const authed = (c: Context) => session(c) !== undefined;
  /** 401 if not logged in, 403 if only a viewer; undefined when the caller is an admin. */
  const requireAdmin = (c: Context, mutation = false): Response | undefined => {
    const s = session(c);
    if (!s) return c.body(null, 401);
    if (s.role !== "admin") return c.body(null, 403);
    if (mutation && c.req.header("x-po-csrf") !== "1") return c.body(null, 403);
    return undefined;
  };
  const setSession = (c: Context, value: string, ttl: number) =>
    setCookie(c, SESSION_COOKIE, value, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: ttl / 1000, secure: isHttps(c) });
  /** Shared rate limit for every way of presenting a secret to log in. Returns false when blocked. */
  const allowAttempt = (c: Context): boolean => {
    const ip = clientIp(c);
    const now = clock();
    let rec = attempts.get(ip);
    if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    if (rec.count >= LOGIN_MAX_ATTEMPTS) return false;
    rec.count++;
    attempts.set(ip, rec);
    return true;
  };

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
      if (!presented) return c.body(null, 401);
      // The shared token (no name) or a person's own token (their name on everything).
      const person = safeEqual(presented, secrets.ingestToken) ? undefined : users?.findUserByToken(presented);
      if (!person && !safeEqual(presented, secrets.ingestToken)) return c.body(null, 401);
      const adapter = adapters[c.req.param("source")];
      if (!adapter) return c.body(null, 404);
      let payload: unknown;
      try {
        payload = await c.req.json();
      } catch {
        return c.body(null, 400);
      }
      // Side-channel from the Claude hook: context window use, read from the transcript.
      const ctx = Number(c.req.header("x-po-context-tokens"));
      if (Number.isSafeInteger(ctx) && ctx > 0 && payload && typeof payload === "object" && !Array.isArray(payload)) {
        (payload as Record<string, unknown>)._context_tokens = ctx;
      }
      // …and the git branch the session is on.
      const branch = c.req.header("x-po-git-branch")?.replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 100);
      if (branch && payload && typeof payload === "object" && !Array.isArray(payload)) {
        (payload as Record<string, unknown>)._git_branch = branch;
      }
      const now = clock();
      if (person) users?.touch(person.id, now);
      hub.apply(adapter.toEvents(payload, now).map((e) => stampUser(e, person?.name)));
      return c.body(null, 204);
    },
  );

  app.get("/login", (c) => (authed(c) ? c.redirect("/") : c.html(loginPage())));

  // Login with the password or the admin token (same field). Both make you an admin.
  app.post("/login", async (c) => {
    if (!allowAttempt(c)) return c.html(loginPage("Too many attempts. Try again in a few minutes."), 429);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const secret = typeof form.password === "string" ? form.password : "";
    const ok = !!secret && (isAdminToken(secrets, secret) || verifyPassword(secret, secrets.passwordHash));
    if (!ok) return c.html(loginPage("Wrong password or admin token."), 401);
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + SESSION_TTL_MS), SESSION_TTL_MS);
    return c.redirect("/", 303);
  });

  // Setup link: /admin?token=<admin token> logs in as admin and opens the People panel.
  app.get("/admin", (c) => {
    if (!allowAttempt(c)) return c.redirect("/login");
    if (!isAdminToken(secrets, c.req.query("token"))) return c.redirect("/login");
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + SESSION_TTL_MS), SESSION_TTL_MS);
    return c.redirect("/?people");
  });

  // A screen (TV): /tv?key=<display key> logs this browser in as a viewer for a year.
  app.get("/tv", (c) => {
    if (!allowAttempt(c)) return c.redirect("/login");
    const display = users?.findDisplayByKey(c.req.query("key") ?? "");
    if (!display) return c.redirect("/login");
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + VIEWER_TTL_MS, { displayId: display.id }), VIEWER_TTL_MS);
    return c.redirect("/?tv");
  });

  app.get("/api/me", (c) => {
    const s = session(c);
    return s ? c.json({ role: s.role }) : c.body(null, 401);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });

  app.get("/api/state", (c) => (authed(c) ? c.json(hub.snapshot) : c.body(null, 401)));

  // Replay: the state just before the retained window, plus every event since.
  app.get("/api/history", (c) => (authed(c) ? c.json(hub.getHistory(clock())) : c.body(null, 401)));

  app.get("/api/settings", (c) => (authed(c) ? c.json(settings.get()) : c.body(null, 401)));
  app.get("/api/stats", (c) => (authed(c) ? c.json(deps.stats?.get() ?? emptyStats()) : c.body(null, 401)));

  // Changing settings needs the cookie and a custom header a cross-site form can't send.
  app.put("/api/settings", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    try {
      return c.json(settings.set(input));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid settings" }, 400);
    }
  });

  // People: one ingest token each. Admin only.
  app.get("/api/users", (c) => requireAdmin(c) ?? c.json(users?.listUsers() ?? []));
  app.post("/api/users", bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    if (!users) return c.body(null, 503);
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    try {
      return c.json(users.addUser(body.name, clock()), 201);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, err.code === "duplicate" ? 409 : 400);
      throw err;
    }
  });
  app.delete("/api/users/:id", (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    return users?.removeUser(c.req.param("id")) ? c.body(null, 204) : c.body(null, 404);
  });

  // Display links for screens. Admin only.
  app.get("/api/displays", (c) => requireAdmin(c) ?? c.json(users?.listDisplays() ?? []));
  app.post("/api/displays", bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    if (!users) return c.body(null, 503);
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    try {
      const { display, key } = users.addDisplay(body.name, clock());
      return c.json({ display, key, url: `/tv?key=${key}` }, 201);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  app.delete("/api/displays/:id", (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    return users?.removeDisplay(c.req.param("id")) ? c.body(null, 204) : c.body(null, 404);
  });

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

/** The server decides whose agent it is: overwrite (or drop) whatever `user` the client sent. */
function stampUser(e: AgentEvent, user: string | undefined): AgentEvent {
  const { user: _ignored, ...rest } = e;
  return (user ? { ...rest, user } : rest) as AgentEvent;
}
