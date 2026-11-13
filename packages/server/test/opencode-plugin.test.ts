import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PixelOffice } from "../../../plugins/opencode/pixel-office.js";

/** The OpenCode plugin itself, against a fake office: several offices, and the connection toast. */
describe("OpenCode plugin", () => {
  let server: Server;
  let base = "";
  const hits: { path: string; auth?: string }[] = [];
  let revoked = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const path = req.url ?? "";
        hits.push({ path, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) });
        if (path === "/old/health") return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        if (path.startsWith("/old/") || path.startsWith("/wrong/")) return res.writeHead(404).end();
        const ok = req.headers.authorization === "Bearer good" && !revoked;
        if (path.endsWith("/ingest/check")) {
          return res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify(ok ? { ok, name: "Kasper" } : { ok }));
        }
        res.writeHead(ok ? 204 : 401).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());
  afterEach(() => {
    vi.unstubAllEnvs();
    hits.length = 0;
    revoked = false;
  });

  const start = async (urls: string, tokens: string) => {
    vi.stubEnv("PIXEL_OFFICE_URL", urls);
    vi.stubEnv("PIXEL_OFFICE_TOKEN", tokens);
    const toasts: { message: string; variant: string }[] = [];
    const client = { tui: { showToast: async ({ body }: { body: { message: string; variant: string } }) => void toasts.push(body) } };
    const hooks = await PixelOffice({ directory: "/x/proj", client });
    return { hooks, toasts };
  };

  it("shows one toast on start with every office's status", async () => {
    const { toasts } = await start(`${base}/home, ${base}/work/ http://127.0.0.1:1`, "good,bad good");
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    const host = new URL(base).host;
    expect(toasts[0]).toEqual({
      title: "pixel-office",
      variant: "warning",
      message: [`${host}: connected as Kasper`, `${host}: token rejected`, `127.0.0.1:1: can't reach the server`].join("\n"),
    });
  });

  it("sends every event to every office with its own token", async () => {
    const { hooks, toasts } = await start(`${base}/a,${base}/b`, "good");
    await vi.waitFor(() => expect(toasts).toEqual([expect.objectContaining({ variant: "success" })]));
    hits.length = 0;
    await hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: {} });
    await vi.waitFor(() => expect(hits).toHaveLength(2));
    expect(hits.map((h) => `${h.path} ${h.auth}`).sort()).toEqual(["/a/ingest/opencode Bearer good", "/b/ingest/opencode Bearer good"]);
    expect(toasts).toHaveLength(1); // nothing changed, no new toast
  });

  it("toasts when an office starts rejecting the token, and again when it is back", async () => {
    const { hooks, toasts } = await start(`${base}/home`, "good");
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    const host = new URL(base).host;
    const tool = () => hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: {} });

    revoked = true;
    await tool();
    await tool(); // still rejected: no second toast for the same news
    await vi.waitFor(() => expect(toasts).toHaveLength(2));
    expect(toasts[1]).toEqual({ title: "pixel-office", variant: "error", message: `${host}: token rejected` });

    revoked = false;
    await tool();
    await vi.waitFor(() => expect(toasts).toHaveLength(3));
    expect(toasts[2]).toEqual({ title: "pixel-office", variant: "success", message: `${host}: connected as Kasper` });
  });

  it("tells an older pixel-office apart from a wrong URL", async () => {
    const { toasts } = await start(`${base}/old ${base}/wrong`, "good");
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    const host = new URL(base).host;
    expect(toasts[0]?.message.split("\n")).toEqual([
      `${host}: connected (older server: update it to check the token)`,
      `${host}: not a pixel-office server (check the URL)`,
    ]);
  });

  it("does nothing without a URL", async () => {
    const { hooks } = await start("", "good");
    expect(hooks).toEqual({});
  });
});
