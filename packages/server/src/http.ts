import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Adapter } from "./adapters/index.js";
import { isThrowawaySession } from "./adapters/common.js";
import type { Config } from "./config.js";
import type { Hub } from "./hub.js";
import type { SettingsStore } from "./settings.js";
import { UserError, type UsersStore } from "./users.js";
import type { AgentEvent, Me } from "@pixel-office/protocol";
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
  config: Pick<Config, "cookieSecure" | "trustProxy" | "webDir"> & Partial<Pick<Config, "dataDir" | "adminToken">>;
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
  ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/**
 * The session behind a cookie:
 *  - admin: the admin token (or, before anyone is admin, the old shared password);
 *  - a person: their CURRENT role comes from the users store, so removing or
 *    demoting someone takes effect on their next request;
 *  - viewer: a TV logged in with a code; revoking the screen logs it out.
 */
export function sessionFrom(
  secrets: Secrets,
  cookieValue: string | undefined,
  now = Date.now(),
  users?: UsersStore,
): Session | undefined {
  const s = readSession(secrets.sessionSecret, cookieValue, now);
  if (!s) return undefined;
  if (s.role === "viewer") return s.displayId && users?.hasDisplay(s.displayId) ? s : undefined;
  if (s.userId) {
    const person = users?.getUser(s.userId);
    return person ? { role: person.role, userId: person.id } : undefined;
  }
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

  /**
   * Is this the admin token? If not, look at secrets.json once more: a token made
   * with `pnpm start token --admin --rotate` while the server runs then works
   * right away, without a restart. (An env-pinned admin token always wins.)
   */
  const adminTokenOk = (presented: string | undefined): boolean => {
    if (isAdminToken(secrets, presented)) return true;
    if (!presented || config.adminToken || !config.dataDir) return false;
    try {
      const stored = JSON.parse(readFileSync(join(config.dataDir, "secrets.json"), "utf8")) as { adminTokenHash?: string };
      if (stored.adminTokenHash && stored.adminTokenHash !== secrets.adminTokenHash) {
        secrets.adminTokenHash = stored.adminTokenHash;
        return isAdminToken(secrets, presented);
      }
    } catch {
      // no file / unreadable: keep what we have
    }
    return false;
  };

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
  /** 401 if not logged in, 403 for members and viewers; undefined when the caller is an admin. */
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
      // …and background commands that finished, found in the transcript: "toolu_1:completed,toolu_2:failed".
      const jobs = c.req.header("x-po-jobs");
      if (jobs && payload && typeof payload === "object" && !Array.isArray(payload)) {
        (payload as Record<string, unknown>)._jobs = parseJobs(jobs);
      }
      const now = clock();
      if (person) users?.touch(person.id, now);
      const events = adapter.toEvents(payload, now).filter((e) => !isThrowawaySession(e));
      hub.apply(events.map((e) => stampUser(e, person?.name)));
      return c.body(null, 204);
    },
  );

  // `?e=` explains why a link sent you here (a bad admin link, or too many tries).
  const LOGIN_ERRORS: Record<string, string> = {
    admin: "That admin link didn't work: the admin token isn't right. Make a new one with `pnpm start token --admin --rotate` on the server.",
    wait: "Too many attempts. Try again in a few minutes.",
    tv: "That TV code didn't work.",
  };
  app.get("/login", (c) => (authed(c) ? c.redirect("/") : c.html(loginPage(LOGIN_ERRORS[c.req.query("e") ?? ""]))));

  // Log in with your name and your own password, or your personal token (the one in your Claude plugin).
  // The admin token works too (name ignored) — the setup / emergency key. Until
  // someone has the admin role, the old shared password still works as well.
  app.post("/login", async (c) => {
    if (!allowAttempt(c)) return c.html(loginPage("Too many attempts. Try again in a few minutes."), 429);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const name = typeof form.name === "string" ? form.name.trim() : "";
    // `password` is the field name older login pages used.
    const secret = typeof form.token === "string" ? form.token.trim() : typeof form.password === "string" ? form.password : "";
    const fail = () => c.html(loginPage("That name and password (or token) don't match.", name), 401);
    if (!secret) return fail();

    const person = users?.findUserByToken(secret) ?? (name ? users?.findUserByPassword(name, secret) : undefined);
    if (person) {
      if (person.name.toLowerCase() !== name.toLowerCase()) return fail();
      attempts.delete(clientIp(c));
      setSession(c, signSession(secrets.sessionSecret, clock() + SESSION_TTL_MS, { userId: person.id }), SESSION_TTL_MS);
      return c.redirect("/", 303);
    }
    const bootstrapPassword = !!secrets.passwordHash && !users?.hasAdmins() && verifyPassword(secret, secrets.passwordHash);
    if (!adminTokenOk(secret) && !bootstrapPassword) return fail();
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + SESSION_TTL_MS), SESSION_TTL_MS);
    return c.redirect("/", 303);
  });

  // Setup link: /admin?token=<admin token> logs in as admin and opens the People panel.
  app.get("/admin", (c) => {
    if (!allowAttempt(c)) return c.redirect("/login?e=wait");
    if (!adminTokenOk(c.req.query("token"))) return c.redirect("/login?e=admin");
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + SESSION_TTL_MS), SESSION_TTL_MS);
    return c.redirect("/?people");
  });

  // A screen (TV): its 6-letter code logs this browser in as a viewer for a year.
  // /tv/abc-def, /tv?key=abc-def, or the "TV code" box on the login page (POST /tv).
  const tvLogin = (c: Context, code: string, fail: () => Response) => {
    if (!allowAttempt(c)) return fail();
    const display = users?.findDisplayByKey(code);
    if (!display) return fail();
    attempts.delete(clientIp(c));
    setSession(c, signSession(secrets.sessionSecret, clock() + VIEWER_TTL_MS, { displayId: display.id }), VIEWER_TTL_MS);
    return c.redirect("/?tv", 303);
  };
  app.get("/tv", (c) => tvLogin(c, c.req.query("key") ?? "", () => c.redirect("/login?e=tv")));
  app.get("/tv/:code", (c) => tvLogin(c, c.req.param("code"), () => c.redirect("/login?e=tv")));
  app.post("/tv", bodyLimit({ maxSize: 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const code = typeof form.code === "string" ? form.code : "";
    return tvLogin(c, code, () => c.html(loginPage("That TV code didn't work."), 401));
  });

  app.get("/api/me", (c) => {
    const s = session(c);
    if (!s) return c.body(null, 401);
    const person = s.userId ? users?.getUser(s.userId) : undefined;
    const me: Me = { role: s.role, ...(person ? { user: { id: person.id, name: person.name, ...(person.hasPassword ? { hasPassword: true } : {}) } } : {}) };
    return c.json(me);
  });

  // A person gets a new token for themselves (their old one stops working; they stay logged in).
  app.post("/api/me/token", (c) => {
    const s = session(c);
    if (!s) return c.body(null, 401);
    if (!s.userId) return c.body(null, 403);
    if (c.req.header("x-po-csrf") !== "1") return c.body(null, 403);
    const token = users?.regenerateUserToken(s.userId);
    return token ? c.json({ token }) : c.body(null, 404);
  });

  // A person sets or changes their own password. Changing it needs the current one.
  app.post("/api/me/password", bodyLimit({ maxSize: 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const s = session(c);
    if (!s) return c.body(null, 401);
    if (!s.userId || !users) return c.body(null, 403);
    if (c.req.header("x-po-csrf") !== "1") return c.body(null, 403);
    const body = (await c.req.json().catch(() => ({}))) as { current?: unknown; password?: unknown };
    if (users.getUser(s.userId)?.hasPassword) {
      if (!allowAttempt(c)) return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
      if (typeof body.current !== "string" || !users.checkPassword(s.userId, body.current)) {
        return c.json({ error: "Your current password isn't right." }, 403);
      }
      attempts.delete(clientIp(c));
    }
    try {
      const user = users.setPassword(s.userId, body.password);
      return user ? c.body(null, 204) : c.body(null, 404);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, 400);
      throw err;
    }
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
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; role?: unknown };
    try {
      return c.json(users.addUser(body.name, body.role, clock()), 201);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, err.code === "duplicate" ? 409 : 400);
      throw err;
    }
  });
  // A new token for someone; their old one stops working right away.
  app.post("/api/users/:id/token", (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    const token = users?.regenerateUserToken(c.req.param("id"));
    return token ? c.json({ token }) : c.body(null, 404);
  });

  // Make someone an admin or a member. (The admin token always works, so demoting
  // the last admin can't lock you out.)
  app.patch("/api/users/:id", bodyLimit({ maxSize: 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
    try {
      const user = users?.setRole(c.req.param("id"), body.role);
      return user ? c.json(user) : c.body(null, 404);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // An admin clears someone's forgotten password: they log in with their token again and pick a new one.
  app.delete("/api/users/:id/password", (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    return users?.clearPassword(c.req.param("id")) ? c.body(null, 204) : c.body(null, 404);
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
      return c.json({ display, key, code: key, url: `/tv/${key}` }, 201);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  app.post("/api/displays/:id/code", (c) => {
    const denied = requireAdmin(c, true);
    if (denied) return denied;
    const code = users?.regenerateDisplayCode(c.req.param("id"));
    return code ? c.json({ code, url: `/tv/${code}` }) : c.body(null, 404);
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

/** The x-po-jobs header: finished background commands as tool call id → status (at most 50). */
export function parseJobs(header: string): { callId: string; status: string }[] {
  return header
    .split(",")
    .slice(0, 50)
    .map((pair) => pair.trim().split(":"))
    .filter((p): p is [string, string] => p.length === 2 && /^[A-Za-z0-9_-]{1,200}$/.test(p[0]!) && /^[a-z_]{1,20}$/.test(p[1]!))
    .map(([callId, status]) => ({ callId, status }));
}
