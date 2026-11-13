/**
 * pixel-office plugin for OpenCode.
 *
 * Forwards session, permission, tool and prompt activity to a pixel-office
 * server. Runs inside the OpenCode process — adds nothing to the model's context.
 *
 * Install: copy to ~/.config/opencode/plugins/ (or run `pixel-office install-opencode`)
 * Configure:
 *   export PIXEL_OFFICE_URL=https://office.example.com
 *   export PIXEL_OFFICE_TOKEN=<ingest token>
 *
 * Several offices (e.g. home and work): list them, comma or space separated,
 * with their tokens in the same order (one token alone is used for all):
 *   export PIXEL_OFFICE_URL="https://home.example.com, https://office.work.com"
 *   export PIXEL_OFFICE_TOKEN="po_u_home…, po_u_work…"
 *
 * Connection status shows as a toast when OpenCode starts, and again whenever
 * an office goes away or comes back.
 */

const FORWARDED_EVENTS = new Set([
  "session.created",
  "session.deleted",
  "session.idle",
  "session.status",
  "session.compacted",
  "session.error",
  "permission.updated",
  "permission.asked",
  "permission.replied",
]);

type Shell = (strings: TemplateStringsArray, ...values: unknown[]) => {
  cwd(dir: string): { quiet(): { nothrow(): { text(): Promise<string> } } };
};
type Toast = { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number };
type Client = { tui?: { showToast?(options: { body: Toast }): Promise<unknown> } };
type Ctx = { directory: string; $?: Shell; client?: Client };

type Office = { url: string; token: string; name: string; status?: string; checking?: boolean };

export const PixelOffice = async ({ directory, $, client }: Ctx) => {
  const offices = parseOffices(process.env.PIXEL_OFFICE_URL, process.env.PIXEL_OFFICE_TOKEN);
  if (offices.length === 0) return {};

  const toast = (body: Toast): void => {
    try {
      client?.tui?.showToast?.({ body }).catch(() => {});
    } catch {
      // no TUI (e.g. `opencode run`), no toast
    }
  };

  /** Remembers each office's last status and shows a toast when one changes. */
  const report = (office: Office, status: string): void => {
    if (office.status === status) return;
    const first = office.status === undefined;
    office.status = status;
    const ok = status.startsWith("connected");
    if (first && offices.some((o) => o.status === undefined)) return; // wait for the rest, then one toast
    const lines = first ? offices.map((o) => `${o.name}: ${o.status}`) : [`${office.name}: ${status}`];
    const allOk = offices.every((o) => o.status?.startsWith("connected"));
    toast({ title: "pixel-office", message: lines.join("\n"), variant: first ? (allOk ? "success" : "warning") : ok ? "success" : "error" });
  };

  const post = async (office: Office, body: Record<string, unknown>): Promise<void> => {
    try {
      const res = await fetch(`${office.url}/ingest/opencode`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${office.token}` },
        body: JSON.stringify({ directory, ...body }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) report(office, "token rejected");
      else if (res.ok && !office.status?.startsWith("connected")) void check(office);
    } catch {
      report(office, "can't reach the server");
    }
  };

  const send = (body: Record<string, unknown>): void => {
    for (const office of offices) void post(office, body);
  };

  /** Asks the office whether it accepts the token, and whose it is. */
  const check = async (office: Office): Promise<void> => {
    if (office.checking) return;
    office.checking = true;
    try {
      const res = await fetch(`${office.url}/ingest/check`, {
        headers: { authorization: `Bearer ${office.token}` },
        signal: AbortSignal.timeout(3000),
      });
      const who = res.ok ? ((await res.json().catch(() => ({}))) as { name?: string }).name : undefined;
      if (res.ok) report(office, who ? `connected as ${who}` : "connected");
      else if (res.status === 401) report(office, "token rejected");
      else if (res.status === 404) report(office, (await isOlderOffice(office)) ? "connected (older server: update it to check the token)" : "not a pixel-office server (check the URL)");
      else report(office, `server answered ${res.status}`);
    } catch {
      report(office, "can't reach the server");
    } finally {
      office.checking = false;
    }
  };
  /** An older pixel-office has no /ingest/check yet; anything else at this address is the wrong URL. */
  const isOlderOffice = async (office: Office): Promise<boolean> => {
    try {
      const res = await fetch(`${office.url}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok && ((await res.json()) as { ok?: unknown }).ok === true;
    } catch {
      return false;
    }
  };
  for (const office of offices) void check(office);

  /** The git branch of the project, for the team label. Never throws. */
  const sendBranch = async (props: unknown): Promise<void> => {
    try {
      const info = (props as { info?: { id?: string; parentID?: string } } | undefined)?.info;
      if (!$ || !info?.id || info.parentID) return;
      const branch = (await $`git branch --show-current`.cwd(directory).quiet().nothrow().text()).trim();
      if (branch) send({ type: "branch", sessionID: info.id, branch: branch.slice(0, 100) });
    } catch {
      // no git, no branch
    }
  };

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (FORWARDED_EVENTS.has(event.type)) {
        send({ type: "event", event });
        if (event.type === "session.created") void sendBranch(event.properties);
        return;
      }
      const props = (event.properties ?? {}) as Record<string, unknown>;
      if (event.type === "message.updated") {
        // Context window use: what the last assistant message sent to the model.
        const info = props.info as
          | { role?: string; sessionID?: string; tokens?: { input?: number; cache?: { read?: number; write?: number } } }
          | undefined;
        const t = info?.tokens;
        if (info?.role !== "assistant" || !info.sessionID || !t) return;
        const tokens = (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
        if (tokens > 0) send({ type: "context", sessionID: info.sessionID, tokens });
      } else if (event.type === "todo.updated") {
        const todos = Array.isArray(props.todos) ? (props.todos as Array<Record<string, unknown>>) : [];
        send({
          type: "todos",
          sessionID: props.sessionID,
          todos: todos.slice(0, 100).map((t) => ({
            id: t.id,
            content: typeof t.content === "string" ? t.content.slice(0, 200) : "",
            status: t.status,
          })),
        });
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => {
      send({ type: "tool.before", input, args: trimArgs(output.args) });
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { metadata?: { error?: unknown } } | undefined,
    ) => {
      const { tool, sessionID, callID } = input;
      send({ type: "tool.after", input: { tool, sessionID, callID }, ok: !output?.metadata?.error });
    },

    "chat.message": async (
      input: { sessionID: string },
      output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> },
    ) => {
      const text = output.parts
        .filter((p) => p.type === "text" && !p.synthetic && p.text)
        .map((p) => p.text)
        .join(" ")
        .slice(0, 1000);
      if (text) send({ type: "chat.message", sessionID: input.sessionID, text });
    },
  };
};

/**
 * "a, b" + "t1, t2" → one office per URL, paired with the token in the same place (or the only token).
 * Not exported: OpenCode runs every export of a plugin file as a plugin.
 */
function parseOffices(urls: string | undefined, tokens: string | undefined): Office[] {
  const list = (v: string | undefined) => (v ?? "").split(/[\s,]+/).filter(Boolean);
  const toks = list(tokens);
  return list(urls).map((raw, i) => {
    const url = raw.replace(/\/+$/, "");
    let name = url;
    try {
      name = new URL(url).host;
    } catch {
      // not a URL; show it as written
    }
    return { url, token: (toks.length === 1 ? toks[0] : toks[i]) ?? "", name };
  });
}

/** Only the fields the server summarizes — never file contents. */
function trimArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  const keep = ["filePath", "path", "pattern", "command", "description", "url", "query", "questions", "subagent_type", "prompt"];
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    const v = args[k];
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (k === "questions" && Array.isArray(v)) out[k] = v.slice(0, 1);
  }
  return out;
}
