import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.js";
import { createApp } from "../src/http.js";
import { Hub } from "../src/hub.js";
import { hashPassword, loadSecrets, signSession, verifySession } from "../src/secrets.js";
import { originMatches } from "../src/ws.js";

function setup() {
  const webDir = mkdtempSync(join(tmpdir(), "po-web-"));
  writeFileSync(join(webDir, "index.html"), "<h1>office</h1>");
  mkdirSync(join(webDir, "assets"));
  writeFileSync(join(webDir, "assets", "app.js"), "console.log(1)");
  const secrets = { sessionSecret: "s".repeat(64), ingestToken: "tok-123", passwordHash: hashPassword("hunter2") };
  const hub = new Hub();
  const app = createApp({ config: { trustProxy: false, webDir }, secrets, hub, adapters: createAdapters() });
  const cookie = `po_session=${signSession(secrets.sessionSecret, Date.now() + 60_000)}`;
  return { app, hub, secrets, cookie };
}

const hookBody = JSON.stringify({ session_id: "abc", cwd: "/x/proj", hook_event_name: "SessionStart", source: "startup" });

describe("session cookies", () => {
  it("signs and verifies, rejects tampering and expiry", () => {
    const v = signSession("secret", 2_000);
    expect(verifySession("secret", v, 1_000)).toBe(true);
    expect(verifySession("secret", v, 3_000)).toBe(false);
    expect(verifySession("other", v, 1_000)).toBe(false);
    expect(verifySession("secret", v.replace(/^\d+/, "9999999"), 1_000)).toBe(false);
    expect(verifySession("secret", undefined)).toBe(false);
  });
});

describe("secrets file", () => {
  it("generates once, then reuses; env wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-data-"));
    const first = loadSecrets(dir, {});
    expect(first.generated.password).toBeTruthy();
    expect(first.generated.ingestToken).toBeTruthy();
    const second = loadSecrets(dir, {});
    expect(second.generated).toEqual({});
    expect(second.secrets.ingestToken).toBe(first.secrets.ingestToken);
    expect(loadSecrets(dir, { ingestToken: "from-env" }).secrets.ingestToken).toBe("from-env");
  });
});

describe("ingest", () => {
  it("rejects missing or wrong tokens", async () => {
    const { app } = setup();
    expect((await app.request("/ingest/claude", { method: "POST", body: hookBody })).status).toBe(401);
    const wrong = await app.request("/ingest/claude", { method: "POST", body: hookBody, headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("accepts a valid token with 204 and an empty body, and applies the event", async () => {
    const { app, hub } = setup();
    const res = await app.request("/ingest/claude", {
      method: "POST",
      body: hookBody,
      headers: { authorization: "Bearer tok-123", "content-type": "application/json" },
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(hub.snapshot.agents["claude:abc"]).toBeDefined();
  });

  it("accepts x-po-token, 404s unknown sources, 400s bad JSON, 413s huge bodies", async () => {
    const { app } = setup();
    const h = { "x-po-token": "tok-123", "content-type": "application/json" };
    expect((await app.request("/ingest/claude", { method: "POST", body: hookBody, headers: h })).status).toBe(204);
    expect((await app.request("/ingest/nope", { method: "POST", body: hookBody, headers: h })).status).toBe(404);
    expect((await app.request("/ingest/claude", { method: "POST", body: "{", headers: h })).status).toBe(400);
    const big = JSON.stringify({ x: "a".repeat(300 * 1024) });
    expect((await app.request("/ingest/claude", { method: "POST", body: big, headers: h })).status).toBe(413);
  });
});

describe("web auth", () => {
  it("redirects the page to /login without a session but serves assets", async () => {
    const { app } = setup();
    const page = await app.request("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login");
    expect((await app.request("/assets/app.js")).status).toBe(200);
    expect((await app.request("/api/state")).status).toBe(401);
    expect((await app.request("/assets/../../etc/passwd")).status).toBe(404);
  });

  it("logs in with the right password and sets a strict http-only cookie", async () => {
    const { app } = setup();
    const bad = await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "nope" }) });
    expect(bad.status).toBe(401);
    const ok = await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "hunter2" }) });
    expect(ok.status).toBe(303);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/po_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
  });

  it("rate-limits login attempts", async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "nope" }) })).status;
    }
    expect(last).toBe(429);
  });

  it("serves the page and state with a valid session", async () => {
    const { app, cookie } = setup();
    const page = await app.request("/", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("office");
    const state = await app.request("/api/state", { headers: { cookie } });
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ agents: {} });
  });
});

describe("websocket origin check", () => {
  it("requires Origin host to equal Host", () => {
    expect(originMatches("https://office.example.com", "office.example.com")).toBe(true);
    expect(originMatches("http://localhost:5173", "localhost:5173")).toBe(true);
    expect(originMatches("https://evil.com", "office.example.com")).toBe(false);
    expect(originMatches(undefined, "office.example.com")).toBe(false);
  });
});
