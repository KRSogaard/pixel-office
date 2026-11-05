import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.js";
import { createApp } from "../src/http.js";
import { Hub } from "../src/hub.js";
import { hashPassword, loadSecrets, newAdminToken, readSession, rotateAdminToken, sha256, signSession } from "../src/secrets.js";
import { SettingsStore } from "../src/settings.js";
import { UserError, UsersStore } from "../src/users.js";

const ADMIN_TOKEN = newAdminToken();

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "po-mu-"));
  const webDir = mkdtempSync(join(tmpdir(), "po-web-"));
  writeFileSync(join(webDir, "index.html"), "<h1>office</h1>");
  const secrets = {
    sessionSecret: "s".repeat(64),
    ingestToken: "shared-tok",
    passwordHash: hashPassword("hunter2"),
    adminTokenHash: sha256(ADMIN_TOKEN),
  };
  const hub = new Hub();
  const users = new UsersStore(dataDir);
  const settings = new SettingsStore(dataDir);
  const app = createApp({ config: { trustProxy: false, webDir }, secrets, hub, settings, users, adapters: createAdapters() });
  const admin = `po_session=${signSession(secrets.sessionSecret, Date.now() + 60_000)}`;
  return { app, hub, users, secrets, admin, dataDir };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
const hook = (sessionId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: sessionId, cwd: "/x/proj", hook_event_name: "SessionStart", source: "startup", ...extra });

describe("users store", () => {
  it("creates, finds by token, rejects duplicates and bad names, removes", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-us-"));
    const store = new UsersStore(dir);
    const { user, token } = store.addUser("  Morten ");
    expect(user.name).toBe("Morten");
    expect(token).toMatch(/^po_u_[A-Za-z0-9_-]{43}$/);
    expect(store.findUserByToken(token)?.id).toBe(user.id);
    expect(store.findUserByToken("po_u_nope")).toBeUndefined();
    expect(() => store.addUser("morten")).toThrow(UserError);
    expect(() => store.addUser("")).toThrow(/1–40/);
    expect(() => store.addUser("x".repeat(41))).toThrow(UserError);
    expect(store.removeUser(user.id)).toBe(true);
    expect(store.findUserByToken(token)).toBeUndefined();
  });

  it("stores only hashes, and picks up changes another process made", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-us-"));
    const server = new UsersStore(dir);
    const cli = new UsersStore(dir);
    const { token } = cli.addUser("Ada");
    const { key } = cli.addDisplay("Kitchen TV");
    const file = readFileSync(join(dir, "users.json"), "utf8");
    expect(file).not.toContain(token);
    expect(file).not.toContain(key);
    expect(file).toContain(sha256(token));
    // The server sees the CLI's additions without a restart.
    expect(server.findUserByToken(token)?.name).toBe("Ada");
    expect(server.findDisplayByKey(key)?.name).toBe("Kitchen TV");
    expect(cli.removeDisplayByName("kitchen tv")).toBe(true);
    expect(server.listDisplays()).toEqual([]);
  });
});

describe("ingest identity", () => {
  it("labels events with the person whose token sent them; the shared token stays anonymous", async () => {
    const { app, hub, users } = setup();
    const { token } = users.addUser("Morten");
    const post = (tok: string, body: string, source = "claude") =>
      app.request(`/ingest/${source}`, { method: "POST", body, headers: { authorization: `Bearer ${tok}` } });

    expect((await post(token, hook("m1"))).status).toBe(204);
    expect(hub.snapshot.agents["claude:m1"]?.user).toBe("Morten");
    expect(users.listUsers()[0]?.lastSeenAt).toBeTypeOf("number");

    expect((await post("shared-tok", hook("s1"))).status).toBe(204);
    expect(hub.snapshot.agents["claude:s1"]?.user).toBeUndefined();

    expect((await post("po_u_forged", hook("x1"))).status).toBe(401);
  });

  it("never trusts a user name the client sent", async () => {
    const { app, hub, users } = setup();
    const { token } = users.addUser("Morten");
    const event = { source: "x", agentId: "g1", sessionId: "g1", project: { path: "/p", name: "p" }, ts: 1, kind: "session.start", user: "Mallory" };
    const send = (tok: string) =>
      app.request("/ingest/generic", { method: "POST", body: JSON.stringify(event), headers: { authorization: `Bearer ${tok}` } });
    await send("shared-tok");
    expect(hub.snapshot.agents.g1?.user).toBeUndefined();
    await send(token);
    expect(hub.snapshot.agents.g1?.user).toBe("Morten");
  });

  it("stops accepting a removed person's token", async () => {
    const { app, users } = setup();
    const { user, token } = users.addUser("Temp");
    users.removeUser(user.id);
    const res = await app.request("/ingest/claude", { method: "POST", body: hook("t1"), headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});

describe("admin login", () => {
  const form = (secret: string) => {
    const body = new URLSearchParams({ password: secret });
    return { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } };
  };

  it("accepts the password or the admin token in the login form, both as admin", async () => {
    const { app } = setup();
    for (const secret of ["hunter2", ADMIN_TOKEN]) {
      const res = await app.request("/login", form(secret));
      expect(res.status).toBe(303);
      const me = await app.request("/api/me", { headers: { cookie: cookieOf(res) } });
      expect(await me.json()).toEqual({ role: "admin" });
    }
  });

  it("opens the People panel from the /admin?token= link", async () => {
    const { app } = setup();
    const res = await app.request(`/admin?token=${ADMIN_TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?people");
    const me = await app.request("/api/me", { headers: { cookie: cookieOf(res) } });
    expect(await me.json()).toEqual({ role: "admin" });
    const bad = await app.request("/admin?token=po_a_wrong");
    expect(bad.headers.get("location")).toMatch(/^\/login/);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("does not let ingest, person or display tokens act as the admin token", async () => {
    const { app, users } = setup();
    const { token } = users.addUser("Ada");
    const { key } = users.addDisplay("TV");
    for (const secret of ["shared-tok", token, key]) {
      expect((await app.request("/login", form(secret))).status).toBe(401);
      const link = await app.request(`/admin?token=${encodeURIComponent(secret)}`);
      expect(link.headers.get("location")).toMatch(/^\/login/);
    }
  });

  it("rate-limits the admin link like the login form", async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i++) await app.request("/admin?token=po_a_wrong");
    const blocked = await app.request(`/admin?token=${ADMIN_TOKEN}`);
    expect(blocked.headers.get("location")).toMatch(/^\/login/);
  });

  it("generates the admin token once, stores only its hash, and can rotate it", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-sec-"));
    const first = loadSecrets(dir, {});
    expect(first.generated.adminToken).toMatch(/^po_a_/);
    const file = readFileSync(join(dir, "secrets.json"), "utf8");
    expect(file).not.toContain(first.generated.adminToken!);
    expect(loadSecrets(dir, {}).generated.adminToken).toBeUndefined();
    const rotated = rotateAdminToken(dir);
    expect(loadSecrets(dir, {}).secrets.adminTokenHash).toBe(sha256(rotated));
    expect(loadSecrets(dir, { adminToken: "from-env" }).secrets.adminTokenHash).toBe(sha256("from-env"));
  });
});

describe("TV links and viewers", () => {
  it("logs a screen in as a viewer for a year and opens TV mode", async () => {
    const { app, users, secrets } = setup();
    const { key } = users.addDisplay("Office TV");
    expect(key).toMatch(/^[a-z]{3}-[a-z]{3}$/);
    const res = await app.request(`/tv/${key}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?tv");
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=31536000/);
    const s = readSession(secrets.sessionSecret, cookieOf(res).split("=")[1]);
    expect(s?.role).toBe("viewer");

    const bad = await app.request("/tv/aaa-aaa");
    expect(bad.headers.get("location")).toMatch(/^\/login/);
  });

  it("accepts the code typed on the login page, in any case or spacing", async () => {
    const { app, users } = setup();
    const { key } = users.addDisplay("Kitchen TV");
    const typed = key.toUpperCase().replace("-", " ");
    const ok = await app.request("/tv", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${encodeURIComponent(typed)}` });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/?tv");
    const bad = await app.request("/tv", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "code=zzz-zzz" });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("That TV code didn");
  });

  it("lets a viewer watch but not change anything", async () => {
    const { app, users } = setup();
    const { key } = users.addDisplay("Office TV");
    const viewer = cookieOf(await app.request(`/tv?key=${key}`));
    const h = { cookie: viewer, "x-po-csrf": "1", "content-type": "application/json" };
    expect((await app.request("/api/state", { headers: { cookie: viewer } })).status).toBe(200);
    expect((await app.request("/api/settings", { headers: { cookie: viewer } })).status).toBe(200);
    expect((await app.request("/api/stats", { headers: { cookie: viewer } })).status).toBe(200);
    expect((await app.request("/", { headers: { cookie: viewer } })).status).toBe(200);
    expect(await (await app.request("/api/me", { headers: { cookie: viewer } })).json()).toEqual({ role: "viewer" });
    expect((await app.request("/api/settings", { method: "PUT", headers: h, body: "{}" })).status).toBe(403);
    expect((await app.request("/api/users", { headers: { cookie: viewer } })).status).toBe(403);
    expect((await app.request("/api/users", { method: "POST", headers: h, body: '{"name":"x"}' })).status).toBe(403);
    expect((await app.request("/api/displays", { headers: { cookie: viewer } })).status).toBe(403);
  });

  it("logs a screen out when its link is revoked", async () => {
    const { app, users } = setup();
    const { display, key } = users.addDisplay("Office TV");
    const viewer = cookieOf(await app.request(`/tv?key=${key}`));
    users.removeDisplay(display.id);
    expect((await app.request("/api/state", { headers: { cookie: viewer } })).status).toBe(401);
    expect((await app.request("/", { headers: { cookie: viewer } })).headers.get("location")).toMatch(/^\/login/);
  });

  it("treats old cookies without a role as admin", async () => {
    const { app, admin } = setup();
    expect(await (await app.request("/api/me", { headers: { cookie: admin } })).json()).toEqual({ role: "admin" });
  });
});

describe("admin API", () => {
  it("adds, lists and removes people and screens", async () => {
    const { app, admin } = setup();
    const h = { cookie: admin, "x-po-csrf": "1", "content-type": "application/json" };

    const created = await app.request("/api/users", { method: "POST", headers: h, body: JSON.stringify({ name: "Morten" }) });
    expect(created.status).toBe(201);
    const { user, token } = (await created.json()) as { user: { id: string; name: string }; token: string };
    expect(user.name).toBe("Morten");
    expect(token).toMatch(/^po_u_/);
    expect((await app.request("/api/users", { method: "POST", headers: h, body: JSON.stringify({ name: "morten" }) })).status).toBe(409);
    expect((await app.request("/api/users", { method: "POST", headers: h, body: JSON.stringify({ name: " " }) })).status).toBe(400);
    const listed = (await (await app.request("/api/users", { headers: { cookie: admin } })).json()) as unknown[];
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    // Mutations need the CSRF header.
    expect((await app.request(`/api/users/${user.id}`, { method: "DELETE", headers: { cookie: admin } })).status).toBe(403);
    expect((await app.request(`/api/users/${user.id}`, { method: "DELETE", headers: h })).status).toBe(204);
    expect((await app.request(`/api/users/${user.id}`, { method: "DELETE", headers: h })).status).toBe(404);

    const d = await app.request("/api/displays", { method: "POST", headers: h, body: JSON.stringify({ name: "Office TV" }) });
    expect(d.status).toBe(201);
    const { display, key, url } = (await d.json()) as { display: { id: string }; key: string; url: string };
    expect(url).toBe(`/tv/${key}`);
    expect(((await (await app.request("/api/displays", { headers: { cookie: admin } })).json()) as unknown[]).length).toBe(1);
    expect((await app.request(`/api/displays/${display.id}`, { method: "DELETE", headers: h })).status).toBe(204);
  });
});

describe("tokens and codes", () => {
  it("makes readable 6-letter TV codes and normalizes what people type", async () => {
    const { newTvCode, normalizeTvCode } = await import("../src/users.js");
    for (let i = 0; i < 200; i++) expect(newTvCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz]{3}-[abcdefghjkmnpqrstuvwxyz]{3}$/);
    expect(normalizeTvCode(" KMB tqr ")).toBe("kmb-tqr");
    expect(normalizeTvCode("kmbtqr")).toBe("kmb-tqr");
    expect(normalizeTvCode("kmb-tq")).toBeUndefined();
    expect(normalizeTvCode("kmo-tqr")).toBeUndefined(); // no o, i or l
  });

  it("regenerates a person's token: the new one works, the old one doesn't", async () => {
    const { app, users } = setup();
    const { user, token } = users.addUser("Morten");
    const admin = cookieOf(await app.request("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=hunter2" }));
    const res = await app.request(`/api/users/${user.id}/token`, { method: "POST", headers: { cookie: admin, "x-po-csrf": "1" } });
    expect(res.status).toBe(200);
    const { token: fresh } = (await res.json()) as { token: string };
    expect(fresh).not.toBe(token);
    expect(users.findUserByToken(token)).toBeUndefined();
    expect(users.findUserByToken(fresh)?.name).toBe("Morten");
  });

  it("gives a screen a new code; the old code stops working", async () => {
    const { users } = setup();
    const { display, key } = users.addDisplay("Lobby");
    const fresh = users.regenerateDisplayCode(display.id)!;
    expect(fresh).toMatch(/^[a-z]{3}-[a-z]{3}$/);
    expect(users.findDisplayByKey(key)).toBeUndefined();
    expect(users.findDisplayByKey(fresh)?.name).toBe("Lobby");
  });
});

describe("name + token login", () => {
  const login = (fields: Record<string, string>) => ({
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const me = async (app: ReturnType<typeof setup>["app"], cookie: string) => {
    const res = await app.request("/api/me", { headers: { cookie } });
    return res.status === 200 ? await res.json() : res.status;
  };

  it("logs a person in with their name and token, as their current role", async () => {
    const { app, users } = setup();
    const { user, token } = users.addUser("Morten");
    const res = await app.request("/login", login({ name: "  morten ", token }));
    expect(res.status).toBe(303);
    const cookie = cookieOf(res);
    expect(await me(app, cookie)).toEqual({ role: "member", user: { id: user.id, name: "Morten" } });

    // Promote: takes effect on the very next request, same cookie.
    users.setRole(user.id, "admin");
    expect(await me(app, cookie)).toMatchObject({ role: "admin" });
    expect((await app.request("/api/users", { headers: { cookie } })).status).toBe(200);
    // Demote: admin APIs are gone at once.
    users.setRole(user.id, "member");
    expect((await app.request("/api/users", { headers: { cookie } })).status).toBe(403);
    // Removed: the session no longer works.
    users.removeUser(user.id);
    expect(await me(app, cookie)).toBe(401);
  });

  it("refuses a token with someone else's name", async () => {
    const { app, users } = setup();
    users.addUser("Ada");
    const { token } = users.addUser("Morten");
    const res = await app.request("/login", login({ name: "Ada", token }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("That name and token don");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("lets the admin token in with any name, as admin", async () => {
    const { app } = setup();
    const res = await app.request("/login", login({ name: "", token: ADMIN_TOKEN }));
    expect(res.status).toBe(303);
    expect(await me(app, cookieOf(res))).toEqual({ role: "admin" });
  });

  it("accepts the old shared password only until someone is an admin", async () => {
    const { app, users } = setup();
    const before = await app.request("/login", login({ token: "hunter2" }));
    expect(before.status).toBe(303);
    const { user } = users.addUser("Kasper", "admin");
    expect(user.role).toBe("admin");
    expect((await app.request("/login", login({ token: "hunter2" }))).status).toBe(401);
  });

  it("lets a member watch and renew their own token, but not manage the office", async () => {
    const { app, users } = setup();
    const { token } = users.addUser("Ada");
    const cookie = cookieOf(await app.request("/login", login({ name: "Ada", token })));
    expect((await app.request("/api/state", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/api/users", { headers: { cookie } })).status).toBe(403);
    expect((await app.request("/api/settings", { method: "PUT", headers: { cookie, "x-po-csrf": "1" }, body: "{}" })).status).toBe(403);
    // Own token: needs the CSRF header; the old token stops working, the session stays.
    expect((await app.request("/api/me/token", { method: "POST", headers: { cookie } })).status).toBe(403);
    const renewed = await app.request("/api/me/token", { method: "POST", headers: { cookie, "x-po-csrf": "1" } });
    expect(renewed.status).toBe(200);
    const { token: fresh } = (await renewed.json()) as { token: string };
    expect(users.findUserByToken(token)).toBeUndefined();
    expect(users.findUserByToken(fresh)?.name).toBe("Ada");
    expect(await me(app, cookie)).toMatchObject({ role: "member" });
  });

  it("only people can renew 'their own' token (not the admin token or a TV)", async () => {
    const { app, admin } = setup();
    expect((await app.request("/api/me/token", { method: "POST", headers: { cookie: admin, "x-po-csrf": "1" } })).status).toBe(403);
  });

  it("changes roles with PATCH, and adds people as admins with POST", async () => {
    const { app, users, admin } = setup();
    const h = { cookie: admin, "x-po-csrf": "1", "content-type": "application/json" };
    const created = await app.request("/api/users", { method: "POST", headers: h, body: JSON.stringify({ name: "Lea", role: "admin" }) });
    const { user } = (await created.json()) as { user: { id: string; role: string } };
    expect(user.role).toBe("admin");
    const patched = await app.request(`/api/users/${user.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ role: "member" }) });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id: user.id, name: "Lea", role: "member" });
    expect((await app.request(`/api/users/${user.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ role: "boss" }) })).status).toBe(400);
    expect((await app.request("/api/users/nope", { method: "PATCH", headers: h, body: JSON.stringify({ role: "admin" }) })).status).toBe(404);
    expect(users.getUser(user.id)?.role).toBe("member");
  });

  it("keeps old cookies working: plain admin and TV viewer", async () => {
    const { app, users, secrets } = setup();
    const oldAdmin = `po_session=${signSession(secrets.sessionSecret, Date.now() + 60_000)}`;
    expect(await me(app, oldAdmin)).toEqual({ role: "admin" });
    const { display } = users.addDisplay("TV");
    const tv = `po_session=${signSession(secrets.sessionSecret, Date.now() + 60_000, { displayId: display.id })}`;
    expect(await me(app, tv)).toEqual({ role: "viewer" });
  });

  it("treats people from older users.json files as members", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-old-"));
    writeFileSync(
      join(dir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", name: "Old", tokenHash: "00", createdAt: 1 }], displays: [] }),
    );
    const store = new UsersStore(dir);
    expect(store.listUsers()[0]).toMatchObject({ name: "Old", role: "member" });
    expect(store.hasAdmins()).toBe(false);
  });
});

describe("admin link after rotating", () => {
  it("accepts a token rotated while the server runs, and says why a bad link failed", async () => {
    const { loadSecrets, rotateAdminToken } = await import("../src/secrets.js");
    const dataDir = mkdtempSync(join(tmpdir(), "po-rot-"));
    const { secrets } = loadSecrets(dataDir, {});
    const app = createApp({
      config: { trustProxy: false, webDir: undefined, dataDir },
      secrets,
      hub: new Hub(),
      settings: new SettingsStore(dataDir),
      users: new UsersStore(dataDir),
      adapters: createAdapters(),
    });
    const fresh = rotateAdminToken(dataDir); // like `pnpm start token --admin --rotate` in another terminal
    const ok = await app.request(`/admin?token=${fresh}`);
    expect(ok.headers.get("location")).toBe("/?people");

    const bad = await app.request("/admin?token=po_a_nope");
    expect(bad.headers.get("location")).toBe("/login?e=admin");
    expect(await (await app.request("/login?e=admin")).text()).toContain("admin link didn");
  });
});

